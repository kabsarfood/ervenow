const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const { deliveryOrdersCreateLimiter } = require("../../shared/middleware/apiRateLimits");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { logger } = require("../../shared/utils/logger");
const { isOrderPaymentGateRequired } = require("../../shared/utils/orderPaymentGate");
const { runCheckoutInsert } = require("../checkout/service");
const {
  createDeliveryOrderFromBody,
  isPaidFromRequestBody,
} = require("../delivery/service");

const router = express.Router();

/**
 * POST /api/order/create — مسار موحد: سلة أو توصيل.
 * افتراضياً (بدون ERVENOW_REQUIRE_ORDER_PAYMENT=1): لا يُشترط دفع — الطلب pending ويُحسب في التقارير/المحفظة عند التسليم كالسابق.
 */
router.post("/create", requireAuth, deliveryOrdersCreateLimiter, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "database not configured", 503);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const items = Array.isArray(body.items) ? body.items : [];

    if (items.length > 0) {
      const out = await runCheckoutInsert(sb, req.appUser, body, { applyPaymentGate: true });
      if (!out.ok) {
        return fail(res, out.message, out.status || 400);
      }
      await bumpDeliveryOrdersListEpoch();
      return ok(res, { orders: out.orders, mode: "cart" });
    }

    const idemKey = normalizeIdempotencyKey(req);
    const cleanBody = { ...body };
    delete cleanBody.idempotency_key;
    if (idemKey) {
      const { data: existing, error: idemErr } = await sb
        .from("orders")
        .select("*")
        .eq("customer_id", req.appUser.id)
        .eq("idempotency_key", idemKey)
        .maybeSingle();
      if (idemErr) return fail(res, idemErr.message, 400);
      if (existing) return ok(res, { order: existing, duplicated: false, idempotentReplay: true, mode: "delivery" });
      cleanBody.idempotency_key = idemKey;
    }

    const extRaw = cleanBody.external_order_id;
    if (extRaw != null && String(extRaw).trim() !== "") {
      const ext = String(extRaw).trim();
      const { data: existing, error: exErr } = await sb.from("orders").select("*").eq("external_order_id", ext).maybeSingle();
      if (exErr) return fail(res, exErr.message, 400);
      if (existing) return ok(res, { order: existing, duplicated: true, mode: "delivery" });
    }

    const isPaid = isOrderPaymentGateRequired() ? isPaidFromRequestBody(cleanBody) : true;
    const initialDeliveryStatus = isPaid ? "pending" : "draft";
    const payment_status = isPaid ? "paid" : "unpaid";

    const { data, error } = await createDeliveryOrderFromBody(sb, req.appUser, cleanBody, {
      initialDeliveryStatus,
      payment_status,
    });
    if (error) return fail(res, error.message, 400);

    if (data && initialDeliveryStatus === "pending") {
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
        logger.error({ err: qe && (qe.message || String(qe)), orderId: data.id }, "[order/create] enqueue new-order");
      }
      await bumpDeliveryOrdersListEpoch();
    }

    return ok(res, {
      order: data,
      duplicated: false,
      mode: "delivery",
      delivery_status: data?.delivery_status,
      paid: isPaid,
    });
  } catch (e) {
    fail(res, e.message || "order create failed", 500);
  }
});

module.exports = router;
