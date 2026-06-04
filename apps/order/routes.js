const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { isDeliveryEngineStoreOtpEnabled } = require("../../shared/utils/deliveryEngineFlags");
const { confirmStoreDeliveryReceipt } = require("../../shared/services/storeDeliveryOtpConfirm");
const { denyUnlessCanPlaceOrders } = require("../../shared/middleware/platformAccess");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const { deliveryOrdersCreateLimiter } = require("../../shared/middleware/apiRateLimits");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { handleUnifiedCartCheckoutHttp } = require("./cartCheckoutHttp");
const { createServiceOrder, isServiceOrderType } = require("../../shared/services/serviceOrderCreate");
const { runUnifiedDeliveryOnlyCreate } = require("./deliveryOrderCreateShared");
const { patchUnifiedOrderStatus, normalizeIncomingStatus } = require("../../shared/services/unifiedOrderStatus");
const { isAllowedDeliveryStatusTransition } = require("../../shared/utils/deliveryStateMachine");
const { getOrderDeliveryStatus } = require("../../shared/domain/orders/orderStatus");
const { broadcastOrderPatch, orderPatchFromRow } = require("../../shared/lib/trackingSocket");
const { sendCustomerDeliveringNotice, sendDriverArrived } = require("../../shared/messages/deliveryCustomerWhatsApp");

const router = express.Router();

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

module.exports = router;
