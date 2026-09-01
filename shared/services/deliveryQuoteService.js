/**
 * ERVENOW DELIVERY ENGINE 1.0 — حساب quote موحد (مسافة + ETA + رسوم).
 */

const { routeKmWithRoughFallback, deliveryEtaMinutesFromKm } = require("../utils/routeDistance");
const {
  storePolicyRowToConfig,
  normalizeFulfillment,
  fulfillmentAllowedForStore,
  deliveryProviderFromFulfillment,
  computeDeliveryFeeQuote,
  publicDeliveryPolicyLabels,
} = require("./deliveryPolicyEngine");

/**
 * @param {object} params
 * @param {object} params.storeRow — صف المتجر من DB
 * @param {number} params.drop_lat
 * @param {number} params.drop_lng
 * @param {string} [params.fulfillment]
 * @param {number} [params.subtotal]
 * @param {boolean} [params.product_includes_delivery]
 */
async function buildDeliveryQuote(params) {
  const storeRow = params.storeRow;
  if (!storeRow || storeRow.lat == null || storeRow.lng == null) {
    return { ok: false, message: "متجر بلا موقع مسجّل", status: 400 };
  }

  const cfg = storePolicyRowToConfig(storeRow);
  const fulfillment = normalizeFulfillment(params.fulfillment, cfg.delivery_policy);

  if (!fulfillmentAllowedForStore(fulfillment, cfg.delivery_policy)) {
    return { ok: false, message: "طريقة الاستلام غير متاحة لهذا المتجر", status: 400 };
  }

  if (fulfillment === "pickup") {
    const feePart = computeDeliveryFeeQuote({
      storeConfig: cfg,
      distance_km: 0,
      subtotal: params.subtotal,
      fulfillment: "pickup",
      product_includes_delivery: params.product_includes_delivery,
    });
    return {
      ok: true,
      distance_km: 0,
      eta_minutes: 0,
      delivery_fee: 0,
      delivery_free: true,
      delivery_provider: "pickup",
      delivery_policy: feePart.delivery_policy,
      fulfillment: "pickup",
      within_radius: true,
      free_delivery_message: feePart.free_delivery_message,
      store_delivery_policy: publicDeliveryPolicyLabels(cfg),
    };
  }

  const lat = Number(params.drop_lat);
  const lng = Number(params.drop_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "موقع التوصيل مطلوب", status: 400 };
  }

  const slat = Number(storeRow.lat);
  const slng = Number(storeRow.lng);
  const km = await routeKmWithRoughFallback(slat, slng, lat, lng);
  if (km == null || !Number.isFinite(km)) {
    return { ok: false, message: "تعذر حساب المسافة", status: 400 };
  }

  const radius = cfg.delivery_radius_km;
  const within_radius = km <= radius;
  if (!within_radius) {
    return {
      ok: false,
      message: "هذا المتجر لا يغطي منطقتك",
      status: 400,
      distance_km: roundKm(km),
      radius_km: radius,
      store_lat: slat,
      store_lng: slng,
      drop_lat: lat,
      drop_lng: lng,
    };
  }

  const feePart = computeDeliveryFeeQuote({
    storeConfig: cfg,
    distance_km: km,
    subtotal: params.subtotal,
    fulfillment,
    product_includes_delivery: params.product_includes_delivery,
  });

  const eta = deliveryEtaMinutesFromKm(km);

  return {
    ok: true,
    distance_km: roundKm(km),
    eta_minutes: eta != null ? eta : null,
    delivery_fee: feePart.delivery_fee,
    delivery_free: feePart.delivery_free,
    delivery_provider: deliveryProviderFromFulfillment(fulfillment),
    delivery_policy: feePart.delivery_policy,
    fulfillment,
    within_radius: true,
    delivery_free_reason: feePart.delivery_free_reason,
    free_delivery_message: feePart.free_delivery_message,
    store_delivery_policy: publicDeliveryPolicyLabels(cfg),
  };
}

function roundKm(km) {
  return Math.round(Number(km) * 100) / 100;
}

module.exports = { buildDeliveryQuote };
