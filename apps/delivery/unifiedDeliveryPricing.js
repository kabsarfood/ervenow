/**
 * تسعير موحد لخدمات التوصيل (ERVENOW unified delivery).
 */

const {
  priceCarTransportInternal,
  priceCarTransportExternal,
  priceCarTransportInternational,
  CAR_TRANSPORT_EXTERNAL_RATE,
  CAR_TRANSPORT_INTERNATIONAL_RATE,
} = require("../../shared/utils/carTransportPricing");

function clampNum(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

const { priceCylinderSwap, priceCentralRefill } = require("../../shared/utils/gasDeliveryPricing");

function priceGasDelivery(cylinders) {
  const c = Math.max(1, Math.min(10, Math.floor(clampNum(cylinders, 1))));
  return priceCylinderSwap(c);
}

/** توصيل داخلي — سعر ثابت مؤقت (حتى تعريف المنتجات والمسافات) */
function priceLocalDeliveryFlat() {
  return 35;
}

function computeUnifiedDeliveryFee(serviceType, payload) {
  const st = String(serviceType || "").trim().toLowerCase();
  const p = payload && typeof payload === "object" ? payload : {};
  if (st === "car_transport") {
    const mode = String(p.transfer_mode || "internal").toLowerCase();
    const km = clampNum(p.distance_km, 0);
    const vehicleCondition = String(p.vehicle_condition || "").trim().toLowerCase();
    if (km <= 0) return { ok: false, message: "distance_km required" };
    if (mode === "external") {
      return { ok: true, delivery_fee: priceCarTransportExternal(km), distance_km: km, mode: "external" };
    }
    if (mode === "international") {
      return {
        ok: true,
        delivery_fee: priceCarTransportInternational(km),
        distance_km: km,
        mode: "international",
      };
    }
    return {
      ok: true,
      delivery_fee: priceCarTransportInternal(km, vehicleCondition),
      distance_km: km,
      mode: "internal",
      vehicle_condition: vehicleCondition || null,
    };
  }
  if (st === "gas_delivery") {
    const mode = String(p.mode || "cylinder").toLowerCase();
    if (mode === "bulk" || mode === "central_refill") {
      const liters = Number(p.liters);
      const fee = priceCentralRefill(liters);
      if (fee <= 0) return { ok: false, message: "liters invalid" };
      return { ok: true, delivery_fee: fee, liters, mode: "bulk" };
    }
    const n = Math.max(1, Math.min(10, Math.floor(clampNum(p.cylinders, 1))));
    return { ok: true, delivery_fee: priceGasDelivery(n), cylinders: n, mode: "cylinder" };
  }
  if (st === "local_delivery") {
    return { ok: true, delivery_fee: priceLocalDeliveryFlat() };
  }
  return { ok: false, message: "unsupported service_type" };
}

module.exports = {
  CAR_TRANSPORT_EXTERNAL_RATE,
  CAR_TRANSPORT_INTERNATIONAL_RATE,
  priceCarTransportInternal,
  priceCarTransportExternal,
  priceCarTransportInternational,
  priceGasDelivery,
  priceLocalDeliveryFlat,
  computeUnifiedDeliveryFee,
};
