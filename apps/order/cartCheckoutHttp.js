/**
 * POST سلة موحّد — يُستدعى من /api/order/create (رسمي) و /api/checkout (مهمل).
 */
const { createServiceClient } = require("../../shared/config/supabase");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const {
  claimOrReplayCheckout,
  finalizeCheckoutIdempotency,
  releaseCheckoutIdempotency,
} = require("../../shared/utils/checkoutIdempotency");
const { logger } = require("../../shared/utils/logger");
const { perfLog } = require("../../shared/utils/perfLog");
const { runCheckoutInsert } = require("../checkout/service");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { deprecateLegacyOrderRoute, UNIFIED_ORDER_CREATE } = require("../../shared/middleware/deprecateLegacyRoute");

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {{ applyPaymentGate?: boolean, deprecated?: boolean }} opts
 */
async function handleUnifiedCartCheckoutHttp(req, res, opts = {}) {
  if (opts.deprecated) deprecateLegacyOrderRoute(req, res, "POST /api/checkout", UNIFIED_ORDER_CREATE);

  const perfStart = Date.now();
  const idemKey = normalizeIdempotencyKey(req);
  let idemClaimed = false;

  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) {
      return res.status(503).json({ ok: false, message: "database not configured" });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, message: "cart empty" });
    }

    if (idemKey) {
      try {
        const idem = await claimOrReplayCheckout(sb, req.appUser.id, idemKey);
        if (idem.replay) return res.json(idem.replay);
        if (idem.conflict) {
          return res.status(409).json({ ok: false, message: "checkout already in progress for this key" });
        }
        idemClaimed = Boolean(idem.claimed);
      } catch (idemErr) {
        logger.error({ err: idemErr && (idemErr.message || String(idemErr)) }, "[cart-checkout] idempotency");
        return res.status(503).json({ ok: false, message: "idempotency unavailable" });
      }
    }

    const insertResult = await runCheckoutInsert(sb, req.appUser, req.body, {
      applyPaymentGate: Boolean(opts.applyPaymentGate),
      checkoutIdempotencyKey: idemKey,
    });
    if (!insertResult.ok) {
      return res.status(insertResult.status || 400).json({ ok: false, message: insertResult.message });
    }

    await bumpDeliveryOrdersListEpoch();

    perfLog("cart-checkout", {
      routeTime: Date.now() - perfStart,
      ordersCount: insertResult.orders.length,
      entry: opts.deprecated ? "checkout_legacy" : "order_create",
    });

    const responseBody = { ok: true, orders: insertResult.orders, mode: "cart" };
    if (idemKey) {
      try {
        await finalizeCheckoutIdempotency(sb, req.appUser.id, idemKey, responseBody);
      } catch (finErr) {
        logger.error({ err: finErr && (finErr.message || String(finErr)) }, "[cart-checkout] idempotency finalize");
      }
    }
    return res.json(responseBody);
  } catch (e) {
    logger.error({ err: e && (e.message || String(e)) }, "CART_CHECKOUT_ERROR");
    try {
      const sb = req.supabase || createServiceClient();
      if (idemKey && idemClaimed && sb) {
        await releaseCheckoutIdempotency(sb, req.appUser.id, idemKey);
      }
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
}

module.exports = { handleUnifiedCartCheckoutHttp };
