const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const { deliveryOrdersCreateLimiter } = require("../../shared/middleware/apiRateLimits");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { runCheckoutInsert } = require("../checkout/service");
const { runUnifiedDeliveryOnlyCreate } = require("./deliveryOrderCreateShared");

const router = express.Router();

/**
 * POST /api/order/create — مسار موحد: سلة أو توصيل.
 * افتراضياً: payment_status=pending على orders، والتوصيل يبقى نشطاً؛ إيداع محفظة المتجر فقط عند payment_status=paid.
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

module.exports = router;
