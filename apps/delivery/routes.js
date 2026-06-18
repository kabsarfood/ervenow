const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { denyUnlessCanPlaceOrders } = require("../../shared/middleware/platformAccess");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const {
  listOrders,
  acceptOrder,
  saveLocation,
  reportGpsError,
  rateOrder,
  cancelOrderByCustomer,
  createDeliveryOrderFromBody,
} = require("./service");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { deliveryOrdersCreateLimiter } = require("../../shared/middleware/apiRateLimits");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const { getOrderProviderId } = require("../../shared/utils/orderProviderId");
const { repairInconsistentOrderFinancials } = require("../../shared/utils/orderTotals");
const { logger } = require("../../shared/utils/logger");
const {
  sendOrderAcceptedToCustomer,
  sendCustomerDeliveringNotice,
  sendDriverArrived,
  sendOrderAcceptedToDriverWhatsApp,
} = require("../../shared/services/whatsappService");
const { cacheGetJson, cacheSetJson } = require("../../shared/utils/redisCache");
const {
  readListEpoch,
  bumpDeliveryOrdersListEpoch,
  buildOrdersListCacheKey,
  LIST_CACHE_TTL_MS,
} = require("../../shared/utils/deliveryOrdersListCache");
const { runUnifiedDeliveryOnlyCreate } = require("../order/deliveryOrderCreateShared");
const { createUnifiedDeliveryOrder } = require("./unifiedDeliveryCreate");
const { notifyProvidersForBooking } = require("../../shared/services/serviceBookingNotify");
const {
  broadcastDriverUpdate,
  broadcastOrderPatch,
  orderPatchFromRow,
} = require("../../shared/lib/trackingSocket");
const { notifyCustomer, notifyDriverUser } = require("../../shared/services/notificationEvents");

const router = express.Router();

/** بعد draft → pending: نفس منطق النشر الأصلي (سلة → checkout-dispatch، وإلا new-order). */
function enqueueJobForPublishedOrder(order) {
  if (!order?.id) return Promise.resolve();
  const b = order.breakdown && typeof order.breakdown === "object" ? order.breakdown : {};
  const groupItems = Array.isArray(b.items) ? b.items : [];
  if (groupItems.length) {
    return enqueueDeliveryJob("checkout-dispatch", {
      orderId: order.id,
      groupItems,
      total: Number(order.order_total) || 0,
      appUserPhone: String(order.customer_phone || ""),
    });
  }
  return enqueueDeliveryJob("new-order", {
    orderId: order.id,
    pickup:
      order.pickup_lat != null && order.pickup_lng != null
        ? { lat: Number(order.pickup_lat), lng: Number(order.pickup_lng) }
        : null,
    dropoff:
      order.drop_lat != null && order.drop_lng != null
        ? { lat: Number(order.drop_lat), lng: Number(order.drop_lng) }
        : null,
  });
}

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

/** يُرفق نوع مركبة المندوب من جدول drivers (للخريطة / التتبع) */
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

router.get("/health", (_req, res) => ok(res, { service: "delivery" }));

/** POST /resolve-maps-link — فك روابط Google Maps (بما فيها maps.app.goo.gl) */
router.post("/resolve-maps-link", optionalAuth, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return fail(res, "url مطلوب", 400);
    const { resolveMapsLink } = require("../../shared/utils/mapsUrlParser");
    const out = await resolveMapsLink(url);
    if (!out) {
      return fail(
        res,
        "تعذر قراءة الإحداثيات من الرابط. انسخ رابط «مشاركة» من Google Maps أو حدد الموقع على الخريطة.",
        400
      );
    }
    return ok(res, out);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

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
      const t1 = Date.now();
      const { count, error } = await sb
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("delivery_status", ["pending", "accepted"]);
      const t2 = Date.now();
      console.log("DB TIME:", t2 - t1);
      if (error) return fail(res, error.message, 400);
      const payload = { ok: true, count: count || 0 };
      await cacheSetJson(cacheKey, payload, LIST_CACHE_TTL_MS);
      return res.json(payload);
    }

    const t1 = Date.now();
    const { data, error } = await listOrders(sb, req.appUser);
    const t2 = Date.now();
    console.log("DB TIME:", t2 - t1);
    if (error) return fail(res, error.message, 400);
    const payload = { ok: true, orders: data || [] };
    await cacheSetJson(cacheKey, payload, LIST_CACHE_TTL_MS);
    return res.json(payload);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/orders/:id", requireAuth, async (req, res) => {
  try {
    const key = String(req.params.id || "").trim();
    if (!key) return fail(res, "id required", 400);
    let q = req.supabase.from("orders").select("*");
    if (isUuidLike(key)) q = q.eq("id", key);
    else q = q.eq("order_number", key);
    const { data, error } = await q.single();
    if (error) return fail(res, error.message, 404);
    const o = repairInconsistentOrderFinancials(data);
    await attachDriverCarType(req.supabase, o);
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
        ((o.delivery_status || o.status) === "new" || (o.delivery_status || o.status) === "pending") && !o.driver_id;
      if (!mine && !open) return fail(res, "Forbidden", 403);
      return ok(res, { order: o });
    }
    return fail(res, "Forbidden", 403);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

/** طلب توصيل موحد (خدمات منصة) — يبدأ بدعم car_transport */
router.post("/create", requireAuth, denyUnlessCanPlaceOrders, deliveryOrdersCreateLimiter, async (req, res) => {
  try {
    const { deprecateLegacyOrderRoute, UNIFIED_ORDER_CREATE } = require("../../shared/middleware/deprecateLegacyRoute");
    deprecateLegacyOrderRoute(req, res, "POST /api/delivery/create", UNIFIED_ORDER_CREATE);
    const body = { ...(req.body || {}) };
    const idk = normalizeIdempotencyKey(req);
    if (idk) body.idempotency_key = idk;

    const { data, error } = await createUnifiedDeliveryOrder(req.supabase, req.appUser, body, {
      initialDeliveryStatus: "pending",
      payment_status: "pending",
    });
    if (error) return fail(res, error.message, 400);

    const isGas =
      String(body.service_type || "").toLowerCase() === "gas_delivery" ||
      (data && data.data && data.data.gas);
    const isServiceOrder =
      data && String(data.order_type || "").trim().toLowerCase() === "service";

    if (isServiceOrder && data) {
      try {
        await notifyProvidersForBooking(req.supabase, data);
      } catch (ne) {
        logger.error({ err: ne && (ne.message || String(ne)), orderId: data.id }, "[delivery/create] notify providers");
      }
      await bumpDeliveryOrdersListEpoch();
      const rowData = data.data && typeof data.data === "object" ? data.data : {};
      const summary = {
        service_type: rowData.service_type || body.service_type,
        from_location: rowData.from_location || null,
        to_location: rowData.to_location || null,
        distance_km: data.distance_km != null ? data.distance_km : rowData.distance_km ?? null,
        price:
          data.delivery_fee != null
            ? data.delivery_fee
            : data.order_total != null
              ? data.order_total
              : rowData.price ?? null,
        commission: data.commission != null ? data.commission : rowData.commission ?? null,
      };
      return ok(res, { order: data, unified: true, summary, gas: false });
    }

    if (!isGas && data && String(data.delivery_status || "") === "pending") {
      try {
        await enqueueDeliveryJob("new-order", {
          orderId: data.id,
          pickup:
            data.pickup_lat != null && data.pickup_lng != null
              ? { lat: Number(data.pickup_lat), lng: Number(data.pickup_lng) }
              : null,
          dropoff:
            data.drop_lat != null && data.drop_lng != null
              ? { lat: Number(data.drop_lat), lng: Number(data.drop_lng) }
              : null,
        });
      } catch (qe) {
        logger.error({ err: qe && (qe.message || String(qe)), orderId: data.id }, "[delivery/create] enqueue new-order");
      }
      await bumpDeliveryOrdersListEpoch();
    } else if (data && !isGas) {
      await bumpDeliveryOrdersListEpoch();
    }

    const rowData = data && data.data && typeof data.data === "object" ? data.data : {};
    const summary = {
      service_type: rowData.service_type || body.service_type,
      from_location: rowData.from_location || null,
      to_location: rowData.to_location || null,
      distance_km: data.distance_km != null ? data.distance_km : rowData.distance_km ?? null,
      price:
        data.delivery_fee != null
          ? data.delivery_fee
          : data.order_total != null
            ? data.order_total
            : rowData.price ?? null,
      commission: data.commission != null ? data.commission : rowData.commission ?? null,
    };
    return ok(res, { order: data, unified: true, summary, gas: Boolean(isGas) });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders", requireAuth, denyUnlessCanPlaceOrders, deliveryOrdersCreateLimiter, async (req, res) => {
  try {
    const { deprecateLegacyOrderRoute, UNIFIED_ORDER_CREATE } = require("../../shared/middleware/deprecateLegacyRoute");
    deprecateLegacyOrderRoute(req, res, "POST /api/delivery/orders", UNIFIED_ORDER_CREATE);
    const body = { ...(req.body || {}) };
    delete body.idempotency_key;

    const unified = await runUnifiedDeliveryOnlyCreate({
      sb: req.supabase,
      appUser: req.appUser,
      body,
      idempotencyKey: normalizeIdempotencyKey(req),
      xSourceHeader: req.get("X-Source"),
      entryPoint: "delivery",
    });
    if (!unified.ok) return fail(res, unified.message, unified.status);

    if (unified.idempotentReplay) {
      return ok(res, { order: unified.order, duplicated: false, idempotentReplay: true });
    }
    if (unified.duplicated) {
      return ok(res, { order: unified.order, duplicated: true });
    }
    return ok(res, { order: unified.order, duplicated: false });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/accept", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const { data, error } = await acceptOrder(req.supabase, orderId, req.appUser.id);
    if (error) {
      const code = error.code === "DRIVER_DEBT_LIMIT" ? 403 : 400;
      if (error.reason === "auto_freeze_block") {
        return res.status(403).json({
          ok: false,
          message: error.message || "تم إيقاف حسابك بسبب تجاوز الحد المالي، يرجى السداد",
          error: error.message,
        });
      }
      return fail(res, error.message, code);
    }

    if (data) {
      await bumpDeliveryOrdersListEpoch();
      const orderLabel = data.order_number || String(data.id);
      const driverInfo = req.appUser.phone || req.appUser.id;

      if (req.appUser.phone) {
        try {
          await sendOrderAcceptedToDriverWhatsApp(data, req.appUser.phone);
        } catch (e) {
          logger.error({ err: e && (e.message || String(e)), orderId: data.id }, "[delivery/accept] driver WhatsApp Twilio");
        }
      }

      if (data.customer_phone) {
        await sendOrderAcceptedToCustomer(data, driverInfo);
      }
      if (data.customer_id) {
        try {
          await notifyCustomer(
            req.supabase,
            data.customer_id,
            "customer.order.accepted",
            "تم قبول الطلب",
            "تم قبول طلبك وبدء تجهيزه.",
            data,
            { driver_id: data.driver_id || req.appUser.id }
          );
          await notifyDriverUser(
            req.supabase,
            req.appUser.id,
            "driver.task.assigned",
            "مهمة جديدة",
            `تم إسناد طلب ${data.order_number || data.id} إليك.`,
            data
          );
        } catch (notifyErr) {
          logger.warn(
            { err: notifyErr.message || String(notifyErr), orderId: data.id },
            "[delivery/accept] customer notification"
          );
        }
      }
      if (data.store_id) {
        try {
          const { notifyStoreForOrderEvent } = require("../../shared/services/platformNotify");
          await notifyStoreForOrderEvent(
            req.supabase,
            data,
            "مندوب في الطريق",
            "تم قبول مندوب لتوصيل طلبك."
          );
        } catch (storeNotifyErr) {
          logger.warn(
            { err: storeNotifyErr.message || String(storeNotifyErr), orderId: data.id },
            "[delivery/accept] store notification"
          );
        }
      }

      const providerPhone =
        (await getUserPhoneById(req.supabase, data.merchant_id)) ||
        (await getUserPhoneById(req.supabase, getOrderProviderId(data)));
      if (providerPhone) {
        const providerMessage = `✅ تم استلام طلب ${orderLabel} بواسطة المندوب ${driverInfo}.`.trim();
        try {
          await sendWhatsApp({ to: providerPhone, message: providerMessage });
        } catch (e) {
          logger.error({ err: e && (e.message || String(e)), orderId: data.id }, "[delivery/accept] provider WhatsApp");
        }
      }
    }

    if (data && data.id) {
      broadcastOrderPatch(String(data.id), orderPatchFromRow(data));
    }

    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/rate", requireAuth, requireRole("customer", "admin"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const b = req.body || {};
    const { data, error } = await rateOrder(req.supabase, orderId, req.appUser, b.rating, b.review);
    if (error) return fail(res, error.message, 400);
    if (data) await bumpDeliveryOrdersListEpoch();
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/cancel", requireAuth, requireRole("customer", "admin"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const { data, error, refund } = await cancelOrderByCustomer(req.supabase, orderId, req.appUser);
    if (error) return fail(res, error.message, 400);
    if (data) await bumpDeliveryOrdersListEpoch();

    if (data && data.driver_id) {
      try {
        const driverPhone = await getUserPhoneById(req.supabase, data.driver_id);
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
          "[delivery/cancel] driver WhatsApp"
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

router.patch("/orders/:id/status", requireAuth, async (req, res) => {
  try {
    const { setDeprecationHeaders, UNIFIED_ORDER_STATUS } = require("../../shared/middleware/deprecateLegacyRoute");
    const { patchUnifiedOrderStatus, normalizeIncomingStatus } = require("../../shared/services/unifiedOrderStatus");
    setDeprecationHeaders(res, UNIFIED_ORDER_STATUS);
    const orderId = String(req.params.id || "").trim();
    const nextRaw = req.body?.delivery_status ?? req.body?.status;
    const nextStatus = normalizeIncomingStatus(nextRaw);
    if (!nextStatus) return fail(res, "delivery_status required", 400);
    const out = await patchUnifiedOrderStatus(req.supabase, orderId, nextStatus, req.appUser);
    if (out.error) {
      const msg = out.error.message || String(out.error);
      return fail(res, msg, msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 400);
    }
    if (out.data?.customer_phone) {
      if (nextStatus === "delivering") await sendCustomerDeliveringNotice(out.data);
      else if (nextStatus === "delivered") await sendDriverArrived(out.data);
    }
    ok(res, { order: out.data, unified_redirect: UNIFIED_ORDER_STATUS });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/location", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    if (req.body && req.body.gps_error === true) {
      const { data, error } = await reportGpsError(req.supabase, req.params.id, req.appUser);
      if (error) return fail(res, error.message, 400);
      return ok(res, { order: data });
    }

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return fail(res, "lat/lng required");
    const { data, error } = await saveLocation(req.supabase, req.params.id, req.appUser, lat, lng);
    if (error) return fail(res, error.message, 400);
    if (data && data.id) {
      broadcastDriverUpdate(String(data.id), req.appUser.id, { lat, lng, ts: Date.now() });
    }
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/complaints", requireAuth, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const orderId = String(req.body?.order_id || "").trim() || null;
    if (!message) return fail(res, "message required", 400);

    const row = {
      user_id: req.appUser.id,
      order_id: orderId,
      message,
      status: "open",
    };
    const { data, error } = await req.supabase.from("complaints").insert(row).select("*").single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { complaint: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/complaints/mine", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("complaints")
      .select("*")
      .eq("user_id", req.appUser.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return fail(res, error.message, 400);
    return ok(res, { complaints: data || [] });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

module.exports = router;
