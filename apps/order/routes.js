const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { isDeliveryEngineStoreOtpEnabled } = require("../../shared/utils/deliveryEngineFlags");
const { confirmStoreDeliveryReceipt } = require("../../shared/services/storeDeliveryOtpConfirm");
const { denyUnlessCanPlaceOrders } = require("../../shared/middleware/platformAccess");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const { deliveryOrdersCreateLimiter } = require("../../shared/middleware/apiRateLimits");
const {
  readListEpoch,
  bumpDeliveryOrdersListEpoch,
  buildOrdersListCacheKey,
  LIST_CACHE_TTL_MS,
} = require("../../shared/utils/deliveryOrdersListCache");
const { cacheGetJson, cacheSetJson } = require("../../shared/utils/redisCache");
const { listOrders, rateOrder, cancelOrderByCustomer } = require("../delivery/service");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { logger } = require("../../shared/utils/logger");
const { handleUnifiedCartCheckoutHttp } = require("./cartCheckoutHttp");
const { createServiceOrder, isServiceOrderType } = require("../../shared/services/serviceOrderCreate");
const { runUnifiedDeliveryOnlyCreate } = require("./deliveryOrderCreateShared");
const { patchUnifiedOrderStatus, normalizeIncomingStatus } = require("../../shared/services/unifiedOrderStatus");
const { isAllowedDeliveryStatusTransition } = require("../../shared/utils/deliveryStateMachine");
const { getOrderDeliveryStatus } = require("../../shared/domain/orders/orderStatus");
const { broadcastOrderPatch, orderPatchFromRow } = require("../../shared/lib/trackingSocket");
const { repairInconsistentOrderFinancials } = require("../../shared/utils/orderTotals");
const {
  sendCustomerDeliveringNotice,
  sendDriverArrived,
} = require("../../shared/services/whatsappService");

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function isUuidLike(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "").trim()
  );
}

async function getUserPhoneById(sb, userId) {
  if (!userId) return null;
  const { data, error } = await sb.from("users").select("phone").eq("id", userId).maybeSingle();
  if (error || !data || !data.phone) return null;
  return String(data.phone);
}

async function attachDriverCarType(sb, order) {
  if (!order || !order.driver_id) return order;
  try {
    const phone = await getUserPhoneById(sb, order.driver_id);
    if (!phone) return order;
    order.driver_phone = String(phone).trim();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) return order;
    const { data: drv, error } = await sb.from("drivers").select("car_type").eq("phone", digits).maybeSingle();
    if (!error && drv && drv.car_type) order.driver_car_type = String(drv.car_type).trim();
  } catch (_e) {}
  return order;
}

const { normalizeOrderTrackingCoords } = require("../../shared/utils/orderTrackingCoords");

async function attachOrderTrackingMeta(sb, order) {
  if (!order) return order;
  normalizeOrderTrackingCoords(order);
  const d = order.data && typeof order.data === "object" ? order.data : {};
  await attachDriverCarType(sb, order);
  const pid = order.provider_id;
  if (pid) {
    try {
      const { data: prov } = await sb.from("users").select("phone, name").eq("id", pid).maybeSingle();
      if (prov) {
        order.provider_name = String(prov.name || "").trim();
        if (!order.driver_phone) order.driver_phone = String(prov.phone || "").trim();
      }
    } catch (_e) {}
  }
  return order;
}

/**
 * GET /api/order/orders — قائمة طلبات العميل (بديل B2C عن GET /api/delivery/orders)
 */
router.get("/orders", optionalAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, getDatabaseConfigHint(), 503);

    const epoch = await readListEpoch();
    const cacheKey = buildOrdersListCacheKey(req, epoch);
    const cached = await cacheGetJson(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!req.appUser) {
      const { count, error } = await sb
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("delivery_status", ["pending", "accepted"]);
      if (error) return fail(res, error.message, 400);
      const payload = { ok: true, count: count || 0 };
      await cacheSetJson(cacheKey, payload, LIST_CACHE_TTL_MS);
      return res.json(payload);
    }

    const { data, error } = await listOrders(sb, req.appUser);
    if (error) return fail(res, error.message, 400);
    const payload = { ok: true, orders: data || [] };
    await cacheSetJson(cacheKey, payload, LIST_CACHE_TTL_MS);
    return res.json(payload);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

/**
 * POST /api/order/create — مسار موحد: سلة أو توصيل.
 * افتراضياً: payment_status=pending على orders، والتوصيل يبقى نشطاً؛ إيداع محفظة المتجر فقط عند payment_status=paid.
 */
router.post("/create", requireAuth, denyUnlessCanPlaceOrders, deliveryOrdersCreateLimiter, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const orderTypeHint = String(body.order_type || body.type || "").trim().toLowerCase();

    if (!items.length && (orderTypeHint === "service" || orderTypeHint === "gas_delivery" || isServiceOrderType(orderTypeHint))) {
      const created = await createServiceOrder(sb, req.appUser, body);
      if (!created.ok) return fail(res, created.message, created.status || 400);
      await bumpDeliveryOrdersListEpoch();
      return ok(res, { order: created.order, mode: "service", order_type: created.order.order_type });
    }

    if (items.length > 0) {
      return handleUnifiedCartCheckoutHttp(req, res, { applyPaymentGate: true });
    }

    const unified = await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser: req.appUser,
      body,
      idempotencyKey: normalizeIdempotencyKey(req),
      xSourceHeader: null,
      entryPoint: "order",
    });
    if (!unified.ok) return fail(res, unified.message, unified.status);

    return ok(res, {
      order: unified.order,
      duplicated: unified.duplicated,
      idempotentReplay: unified.idempotentReplay,
      mode: "delivery",
      delivery_status: unified.delivery_status,
      paid: unified.paid,
    });
  } catch (e) {
    fail(res, e.message || "order create failed", 500);
  }
});

/**
 * POST /api/order/:id/confirm-receipt — عميل يؤكد استلام توصيل المتجر برمز OTP
 */
router.post("/:id/confirm-receipt", requireAuth, async (req, res) => {
  try {
    if (!isDeliveryEngineStoreOtpEnabled()) return fail(res, "Store OTP غير مفعّل", 503);
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);
    const orderId = String(req.params.id || "").trim();
    const code = req.body?.code ?? req.body?.otp;
    const out = await confirmStoreDeliveryReceipt(sb, orderId, req.appUser, code);
    if (!out.ok) return fail(res, out.message, out.status || 400);
    return ok(res, { order: out.order, settlement: out.settlement || null, already: !!out.already });
  } catch (e) {
    return fail(res, e.message || "confirm receipt failed", 500);
  }
});

/**
 * PATCH /api/order/:id/status — الحالة الوحيدة: delivery_status
 * Body: { status } أو { delivery_status } (يُطبَّع إلى delivery_status)
 */
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);

    const orderId = String(req.params.id || "").trim();
    const nextRaw = req.body?.delivery_status ?? req.body?.status;
    const nextStatus = normalizeIncomingStatus(nextRaw);
    if (!nextStatus) return fail(res, "delivery_status required", 400);

    const { data: cur, error: curErr } = await sb
      .from("orders")
      .select("delivery_status")
      .eq("id", orderId)
      .maybeSingle();

    if (!curErr && cur) {
      const current = getOrderDeliveryStatus(cur);
      if (!isAllowedDeliveryStatusTransition(current, nextStatus)) {
        return fail(res, `Invalid transition ${current} → ${nextStatus}`, 400);
      }
    }

    const out = await patchUnifiedOrderStatus(sb, orderId, nextStatus, req.appUser);
    if (out.error) {
      const msg = out.error.message || String(out.error);
      const code = msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 400;
      return fail(res, msg, code);
    }

    const data = out.data;
    if (data && !out.service_booking) {
      const ds = nextStatus;
      if (data.customer_phone) {
        if (ds === "delivering") await sendCustomerDeliveringNotice(data);
        else if (ds === "delivered") await sendDriverArrived(data);
      }
      if (data.id) broadcastOrderPatch(String(data.id), orderPatchFromRow(data));
    }

    return ok(res, {
      order: data,
      entity: out.entity || "order",
      service_booking: !!out.service_booking,
      settlement: out.settlement || null,
    });
  } catch (e) {
    return fail(res, e.message || "status update failed", 500);
  }
});

/**
 * GET /api/order/:id — تفاصيل طلب (بديل B2C عن GET /api/delivery/orders/:id)
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const key = String(req.params.id || "").trim();
    if (!key) return fail(res, "id required", 400);
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);

    let q = sb.from("orders").select("*");
    if (isUuidLike(key)) q = q.eq("id", key);
    else q = q.eq("order_number", key);
    const { data, error } = await q.single();
    if (error) return fail(res, error.message, 404);
    const o = repairInconsistentOrderFinancials(data);
    await attachOrderTrackingMeta(sb, o);
    if (req.appUser.role === "admin") {
      return ok(res, { order: o });
    }
    if (req.appUser.role === "customer") {
      if (o.customer_id !== req.appUser.id) return fail(res, "Forbidden", 403);
      return ok(res, { order: o });
    }
    if (req.appUser.role === "driver") {
      const mine = o.driver_id === req.appUser.id;
      const open =
        ((o.delivery_status || o.status) === "new" || (o.delivery_status || o.status) === "pending") &&
        !o.driver_id;
      if (!mine && !open) return fail(res, "Forbidden", 403);
      return ok(res, { order: o });
    }
    return fail(res, "Forbidden", 403);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

/**
 * POST /api/order/:id/rate — تقييم الطلب (بديل B2C)
 */
router.post("/:id/rate", requireAuth, requireRole("customer", "admin"), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);
    const orderId = String(req.params.id || "").trim();
    const b = req.body || {};
    const { data, error } = await rateOrder(sb, orderId, req.appUser, b.rating, b.review);
    if (error) return fail(res, error.message, 400);
    if (data) await bumpDeliveryOrdersListEpoch();
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

/**
 * POST /api/order/:id/cancel — إلغاء من العميل (بديل B2C)
 */
router.post("/:id/cancel", requireAuth, requireRole("customer", "admin"), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);
    const orderId = String(req.params.id || "").trim();
    const { data, error, refund } = await cancelOrderByCustomer(sb, orderId, req.appUser);
    if (error) return fail(res, error.message, 400);
    if (data) await bumpDeliveryOrdersListEpoch();

    if (data && data.driver_id) {
      try {
        const driverPhone = await getUserPhoneById(sb, data.driver_id);
        if (driverPhone) {
          const orderLabel = data.order_number || String(data.id || orderId);
          const msg = `🚫 تم إلغاء الطلب من زائر المنصة

رقم الطلب: ${orderLabel}
من: ${String(data.pickup_address || "-")}
إلى: ${String(data.drop_address || "-")}`.trim();
          await sendWhatsApp({ to: driverPhone, message: msg });
        }
      } catch (notifyErr) {
        logger.error(
          { err: notifyErr && (notifyErr.message || String(notifyErr)), orderId },
          "[order/cancel] driver WhatsApp"
        );
      }
    }

    return ok(res, {
      order: data,
      refund: refund || null,
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

module.exports = router;
