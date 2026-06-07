/**
 * ERVENOW DELIVERY ENGINE 1.0 — routes (quote, policy, OTP).
 */

const express = require("express");
const crypto = require("crypto");
const { createServiceClient } = require("../../shared/config/supabase");
const { requireAuth, requireStoreRole } = require("../../shared/middleware/auth");
const { ok, fail } = require("../../shared/utils/helpers");
const { isDeliveryEnginePolicyEnabled, isDeliveryEngineStoreOtpEnabled } = require("../../shared/utils/deliveryEngineFlags");
const { buildDeliveryQuote } = require("../../shared/services/deliveryQuoteService");
const {
  normalizeDeliveryPolicy,
  normalizeFreeDeliveryPolicy,
  storePolicyRowToConfig,
  publicDeliveryPolicyLabels,
} = require("../../shared/services/deliveryPolicyEngine");
const { resolveMapsLink } = require("../../shared/utils/mapsUrlParser");
function deliveryEngineRouter(deps) {
  const router = express.Router();
  const loadApprovedStore = deps.loadApprovedStore;
  const assertMerchantOwnsStore = deps.assertMerchantOwnsStore;
  const resolveMerchantStoreByPhone = deps.resolveMerchantStoreByPhone;

  router.get("/public/:id/delivery-quote", async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
      const id = String(req.params.id || "").trim();
      const lat = Number(req.query.lat ?? req.query.drop_lat);
      const lng = Number(req.query.lng ?? req.query.drop_lng);
      const fulfillment = req.query.fulfillment || req.query.fulfillment_mode;
      const subtotal = Number(req.query.subtotal) || 0;
      const includes = req.query.includes_delivery === "1" || req.query.includes_delivery === "true";

      const got = await loadApprovedStore(sb, id);
      if (got.error) return fail(res, got.error, 404);
      const store = got.store;

      const quote = await buildDeliveryQuote({
        storeRow: store,
        drop_lat: lat,
        drop_lng: lng,
        fulfillment,
        subtotal,
        product_includes_delivery: includes,
      });
      if (!quote.ok) return fail(res, quote.message, quote.status || 400);
      return ok(res, { quote });
    } catch (e) {
      console.error("[store/delivery-quote]", e);
      return fail(res, e.message || "خطأ في الخادم", 500);
    }
  });

  router.post("/resolve-maps-link", async (req, res) => {
    try {
      const url = String(req.body?.url || req.body?.link || "").trim();
      if (!url) return fail(res, "الرابط مطلوب", 400);
      const out = await resolveMapsLink(url);
      if (!out || !Number.isFinite(out.lat) || !Number.isFinite(out.lng)) {
        return fail(res, "تعذر استخراج الإحداثيات من الرابط", 400);
      }
      return ok(res, { lat: out.lat, lng: out.lng, maps_url: out.resolved_url || url });
    } catch (e) {
      return fail(res, e.message || "خطأ", 500);
    }
  });

  router.get("/delivery-engine/flags", (_req, res) => {
    return ok(res, {
      DELIVERY_ENGINE_POLICY: isDeliveryEnginePolicyEnabled(),
      DELIVERY_ENGINE_PRECART: require("../../shared/utils/deliveryEngineFlags").isDeliveryEnginePrecartEnabled(),
      DELIVERY_ENGINE_CHECKOUT: require("../../shared/utils/deliveryEngineFlags").isDeliveryEngineCheckoutEnabled(),
      DELIVERY_ENGINE_STORE_OTP: isDeliveryEngineStoreOtpEnabled(),
    });
  });

  router.patch("/delivery-policy", requireAuth, requireStoreRole, async (req, res) => {
    if (!isDeliveryEnginePolicyEnabled()) return fail(res, "Delivery Engine غير مفعّل", 503);
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
      const own = await resolveMerchantStoreByPhone(sb, req.appUser);
      if (own.error) return fail(res, own.error, 403);
      const sid = own.store.id;
      const b = req.body || {};
      const patch = { updated_at: new Date().toISOString() };
      if (b.delivery_policy != null) patch.delivery_policy = normalizeDeliveryPolicy(b.delivery_policy);
      if (b.free_delivery_policy != null) {
        patch.free_delivery_policy = normalizeFreeDeliveryPolicy(b.free_delivery_policy);
      }
      if (b.free_delivery_min_order !== undefined) {
        const v = b.free_delivery_min_order === "" || b.free_delivery_min_order == null ? null : Number(b.free_delivery_min_order);
        patch.free_delivery_min_order = v != null && Number.isFinite(v) ? v : null;
      }
      if (b.free_delivery_radius_km !== undefined) {
        const v =
          b.free_delivery_radius_km === "" || b.free_delivery_radius_km == null
            ? null
            : Number(b.free_delivery_radius_km);
        patch.free_delivery_radius_km = v != null && Number.isFinite(v) ? v : null;
      }
      if (b.delivery_fee_per_km != null) {
        const fp = Number(b.delivery_fee_per_km);
        if (Number.isFinite(fp) && fp > 0) patch.delivery_fee_per_km = Math.min(20, fp);
      }
      let { data, error } = await sb.from("stores").update(patch).eq("id", sid).select("*").single();
      if (error && /delivery_policy|free_delivery|schema cache|column/i.test(String(error.message || ""))) {
        return fail(res, "نفّذ migration_delivery_engine_1.sql على قاعدة البيانات", 400);
      }
      if (error) return fail(res, error.message, 400);
      return ok(res, {
        store: {
          id: data.id,
          delivery_policy: publicDeliveryPolicyLabels(storePolicyRowToConfig(data)),
        },
      });
    } catch (e) {
      console.error("[store/delivery-policy]", e);
      return fail(res, e.message || "خطأ", 500);
    }
  });

  router.post("/orders/:orderId/delivery-otp", requireAuth, requireStoreRole, async (req, res) => {
    if (!isDeliveryEngineStoreOtpEnabled()) return fail(res, "Store OTP غير مفعّل", 503);
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ", 503);
      const orderId = String(req.params.orderId || "").trim();
      const { data: order, error: oErr } = await sb.from("orders").select("id,store_id,delivery_status,breakdown").eq("id", orderId).maybeSingle();
      if (oErr || !order) return fail(res, "الطلب غير موجود", 404);
      const own = await assertMerchantOwnsStore(sb, order.store_id, req.appUser);
      if (own.error) return fail(res, own.error, 403);
      const b = order.breakdown && typeof order.breakdown === "object" ? order.breakdown : {};
      if (b.fulfillment !== "store_delivery" && b.delivery_provider !== "store") {
        return fail(res, "هذا الطلب ليس توصيلاً ذاتياً للمتجر", 400);
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const hash = crypto.createHash("sha256").update(code).digest("hex");
      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const { error: insErr } = await sb.from("order_receipt_otps").insert({
        order_id: orderId,
        code_hash: hash,
        expires_at: expires,
      });
      if (insErr && /order_receipt_otps|schema cache/i.test(String(insErr.message || ""))) {
        return fail(res, "نفّذ migration_delivery_engine_1.sql", 400);
      }
      if (insErr) return fail(res, insErr.message, 400);
      return ok(res, {
        message: "تم إنشاء رمز التأكيد",
        expires_at: expires,
        dev_code: process.env.NODE_ENV === "production" ? undefined : code,
      });
    } catch (e) {
      return fail(res, e.message || "خطأ", 500);
    }
  });

  return router;
}

module.exports = { deliveryEngineRouter };
