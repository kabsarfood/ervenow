/**
 * ERVENOW DELIVERY ENGINE 1.0 — سياسات المتجر وتسعير التوصيل (بدون Ledger).
 */

const { roundMoney } = require("../utils/platformCommission");

const DELIVERY_POLICIES = Object.freeze([
  "pickup_only",
  "store_delivery",
  "ervenow_delivery",
  "store_plus_ervenow",
]);

const FREE_DELIVERY_POLICIES = Object.freeze(["none", "always", "min_order", "radius"]);

const FULFILLMENT_MODES = Object.freeze(["pickup", "store_delivery", "ervenow_delivery"]);

const DEFAULT_FEE_PER_KM = 2.3;

function normalizeDeliveryPolicy(raw) {
  const p = String(raw || "ervenow_delivery").trim().toLowerCase();
  return DELIVERY_POLICIES.includes(p) ? p : "ervenow_delivery";
}

function normalizeFreeDeliveryPolicy(raw) {
  const p = String(raw || "none").trim().toLowerCase();
  return FREE_DELIVERY_POLICIES.includes(p) ? p : "none";
}

function normalizeFulfillment(raw, storePolicy) {
  const f = String(raw || "").trim().toLowerCase();
  if (f === "pickup") return "pickup";
  if (f === "store_delivery" || f === "store") return "store_delivery";
  if (f === "ervenow_delivery" || f === "ervenow") return "ervenow_delivery";
  const pol = normalizeDeliveryPolicy(storePolicy);
  if (pol === "pickup_only") return "pickup";
  if (pol === "store_delivery") return "store_delivery";
  return "ervenow_delivery";
}

function fulfillmentAllowedForStore(fulfillment, storePolicy) {
  const pol = normalizeDeliveryPolicy(storePolicy);
  const f = normalizeFulfillment(fulfillment, pol);
  if (pol === "pickup_only") return f === "pickup";
  if (pol === "store_delivery") return f === "store_delivery";
  if (pol === "ervenow_delivery") return f === "ervenow_delivery";
  if (pol === "store_plus_ervenow") return f === "store_delivery" || f === "ervenow_delivery";
  return false;
}

function deliveryProviderFromFulfillment(fulfillment) {
  const f = normalizeFulfillment(fulfillment);
  if (f === "pickup") return "pickup";
  if (f === "store_delivery") return "store";
  return "ervenow";
}

function storePolicyRowToConfig(row) {
  const r = row && typeof row === "object" ? row : {};
  return {
    delivery_policy: normalizeDeliveryPolicy(r.delivery_policy),
    free_delivery_policy: normalizeFreeDeliveryPolicy(r.free_delivery_policy),
    free_delivery_min_order:
      r.free_delivery_min_order != null && Number.isFinite(Number(r.free_delivery_min_order))
        ? roundMoney(Number(r.free_delivery_min_order))
        : null,
    free_delivery_radius_km:
      r.free_delivery_radius_km != null && Number.isFinite(Number(r.free_delivery_radius_km))
        ? Number(r.free_delivery_radius_km)
        : null,
    delivery_radius_km: Number(r.delivery_radius_km) > 0 ? Number(r.delivery_radius_km) : 5,
    delivery_fee_per_km:
      Number(r.delivery_fee_per_km) > 0 ? Number(r.delivery_fee_per_km) : DEFAULT_FEE_PER_KM,
  };
}

/**
 * @returns {{ delivery_fee: number, delivery_free: boolean, delivery_free_reason: string|null, delivery_policy: string, free_delivery_message: string|null }}
 */
function computeDeliveryFeeQuote({
  storeConfig,
  distance_km,
  subtotal = 0,
  fulfillment = "ervenow_delivery",
  product_includes_delivery = false,
}) {
  const cfg = storePolicyRowToConfig(storeConfig);
  const f = normalizeFulfillment(fulfillment, cfg.delivery_policy);
  const km = Number(distance_km);
  const sub = roundMoney(Number(subtotal) || 0);

  if (product_includes_delivery) {
    return {
      delivery_fee: 0,
      delivery_free: true,
      delivery_free_reason: "product_includes_delivery",
      delivery_policy: "included",
      free_delivery_message: "🚚 هذا المنتج يشمل التوصيل مجاناً",
    };
  }

  if (f === "pickup") {
    return {
      delivery_fee: 0,
      delivery_free: true,
      delivery_free_reason: "pickup",
      delivery_policy: "pickup",
      free_delivery_message: null,
    };
  }

  if (cfg.free_delivery_policy === "always") {
    return {
      delivery_fee: 0,
      delivery_free: true,
      delivery_free_reason: "store_always_free",
      delivery_policy: "free",
      free_delivery_message: "🎁 التوصيل مجاني",
    };
  }

  if (
    cfg.free_delivery_policy === "min_order" &&
    cfg.free_delivery_min_order != null &&
    sub >= cfg.free_delivery_min_order
  ) {
    return {
      delivery_fee: 0,
      delivery_free: true,
      delivery_free_reason: "min_order",
      delivery_policy: "free_above_minimum",
      free_delivery_message: `🎁 التوصيل مجاني للطلبات فوق ${cfg.free_delivery_min_order} ر.س`,
    };
  }

  if (
    cfg.free_delivery_policy === "radius" &&
    cfg.free_delivery_radius_km != null &&
    Number.isFinite(km) &&
    km <= cfg.free_delivery_radius_km
  ) {
    return {
      delivery_fee: 0,
      delivery_free: true,
      delivery_free_reason: "radius",
      delivery_policy: "free_within_radius",
      free_delivery_message: `🎁 توصيل مجاني حتى ${cfg.free_delivery_radius_km} كم`,
    };
  }

  const feePerKm = cfg.delivery_fee_per_km;
  const fee = Number.isFinite(km) && km >= 0 ? roundMoney(km * feePerKm) : 0;
  let promo = null;
  if (cfg.free_delivery_policy === "min_order" && cfg.free_delivery_min_order != null) {
    promo = `🎁 التوصيل مجاني للطلبات فوق ${cfg.free_delivery_min_order} ر.س`;
  } else if (cfg.free_delivery_policy === "radius" && cfg.free_delivery_radius_km != null) {
    promo = `🎁 توصيل مجاني حتى ${cfg.free_delivery_radius_km} كم`;
  }

  return {
    delivery_fee: fee,
    delivery_free: false,
    delivery_free_reason: null,
    delivery_policy: "distance_based",
    free_delivery_message: promo,
  };
}

function publicDeliveryPolicyLabels(cfg) {
  const c = storePolicyRowToConfig(cfg);
  const labels = {
    pickup_only: "استلام من المتجر فقط",
    store_delivery: "توصيل بواسطة المتجر",
    ervenow_delivery: "توصيل بواسطة ERVENOW",
    store_plus_ervenow: "استلام أو توصيل (متجر / ERVENOW)",
  };
  return {
    delivery_policy: c.delivery_policy,
    delivery_policy_label_ar: labels[c.delivery_policy] || labels.ervenow_delivery,
    free_delivery_policy: c.free_delivery_policy,
    free_delivery_min_order: c.free_delivery_min_order,
    free_delivery_radius_km: c.free_delivery_radius_km,
    promo_message: computeDeliveryFeeQuote({
      storeConfig: c,
      distance_km: 0,
      subtotal: 0,
      fulfillment: "ervenow_delivery",
    }).free_delivery_message,
  };
}

module.exports = {
  DELIVERY_POLICIES,
  FREE_DELIVERY_POLICIES,
  FULFILLMENT_MODES,
  DEFAULT_FEE_PER_KM,
  normalizeDeliveryPolicy,
  normalizeFreeDeliveryPolicy,
  normalizeFulfillment,
  fulfillmentAllowedForStore,
  deliveryProviderFromFulfillment,
  storePolicyRowToConfig,
  computeDeliveryFeeQuote,
  publicDeliveryPolicyLabels,
};
