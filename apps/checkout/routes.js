const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { perfLog } = require("../../shared/utils/perfLog");
const { checkoutLimiter } = require("../../shared/middleware/apiRateLimits");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const {
  claimOrReplayCheckout,
  finalizeCheckoutIdempotency,
  releaseCheckoutIdempotency,
} = require("../../shared/utils/checkoutIdempotency");
const { logger } = require("../../shared/utils/logger");
const { runCheckoutInsert } = require("./service");

const router = express.Router();

/**
 * ============================================================
 * ERVENOW CHECKOUT FLOW — SYSTEM SEPARATION (مهم جدًا)
 * ============================================================
 *
 * لدينا نظامين مختلفين للطلبات:
 *
 * 1) orders (مطاعم / متاجر / منتجات)
 *    - restaurant
 *    - store
 *    - supermarket
 *    - pharmacy
 *
 *    👉 هذه تذهب إلى جدول: orders
 *    👉 مرتبطة بالتوصيل (drivers)
 *
 *
 * 2) services (الخدمات + كداد)
 *    - service
 *    - plumber
 *    - electrician
 *    - vehicle_transfer
 *    - internal_delivery
 *    - pickup_truck
 *    - furniture_move
 *    - gas_delivery
 *
 *    👉 هذه تذهب إلى جدول: service_bookings
 *    👉 مرتبطة بمزودي الخدمة (service providers)
 *
 *
 * ❗ ملاحظة مهمة:
 * internal_delivery يعتبر "خدمة" وليس "توصيل مطعم"
 * لذلك لا يدخل في orders ولا نظام drivers
 *
 *
 * 🎯 الهدف من هذا الفصل:
 * - منع تعارض الأنظمة
 * - وضوح في التقارير
 * - سهولة التوسع مستقبلاً
 *
 *
 * ❗ أي تعديل على التصنيف يجب أن يراعي هذا الفصل
 * ============================================================
 */
router.post("/", requireAuth, checkoutLimiter, async (req, res) => {
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
        logger.error({ err: idemErr && (idemErr.message || String(idemErr)) }, "[checkout] idempotency");
        return res.status(503).json({ ok: false, message: "idempotency unavailable" });
      }
    }

    const insertResult = await runCheckoutInsert(sb, req.appUser, req.body, { applyPaymentGate: false });
    if (!insertResult.ok) {
      return res.status(insertResult.status || 400).json({ ok: false, message: insertResult.message });
    }
    const results = insertResult.orders;

    perfLog("checkout", {
      routeTime: Date.now() - perfStart,
      osrmStatus: "queued_dispatch",
      ordersCount: results.length,
    });
    const responseBody = { ok: true, orders: results };
    if (idemKey) {
      try {
        await finalizeCheckoutIdempotency(sb, req.appUser.id, idemKey, responseBody);
      } catch (finErr) {
        logger.error({ err: finErr && (finErr.message || String(finErr)) }, "[checkout] idempotency finalize");
      }
    }
    return res.json(responseBody);
  } catch (e) {
    logger.error({ err: e && (e.message || String(e)) }, "CHECKOUT_ERROR");
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
});

module.exports = router;
