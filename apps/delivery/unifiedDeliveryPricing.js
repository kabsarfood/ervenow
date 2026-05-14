/**
 * تسعير موحد لخدمات التوصيل (ERVENOW unified delivery).
 * car_transport: داخلي = شرائح مسافة | خارجي = كيلومتر × 2
 */

function clampNum(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

/** مسافة الطريق (كم) — للعرض والتخزين؛ التسعير يستخدم نفس القيمة */
function priceCarTransportInternal(distanceKm) {
  const d = Math.max(0, clampNum(distanceKm, 0));
  if (d <= 0) return 0;
  if (d <= 10) return 100;
  if (d <= 35) return 180;
  if (d <= 50) return 200;
  if (d <= 100) return 250;
  return Math.round((250 + (d - 100) * 2) * 100) / 100;
}

function priceCarTransportExternal(distanceKm) {
  const d = Math.max(0, clampNum(distanceKm, 0));
  return Math.round(d * 2 * 100) / 100;
}

function priceGasDelivery(cylinders) {
  const c = Math.max(0, Math.floor(clampNum(cylinders, 0)));
  return c * 35;
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
    if (km <= 0) return { ok: false, message: "distance_km required" };
    if (mode === "external") {
      return { ok: true, delivery_fee: priceCarTransportExternal(km), distance_km: km, mode: "external" };
    }
    return { ok: true, delivery_fee: priceCarTransportInternal(km), distance_km: km, mode: "internal" };
  }
  if (st === "gas_delivery") {
    const n = Math.max(1, Math.floor(clampNum(p.cylinders, 1)));
    return { ok: true, delivery_fee: priceGasDelivery(n), cylinders: n };
  }
  if (st === "local_delivery") {
    return { ok: true, delivery_fee: priceLocalDeliveryFlat() };
  }
  return { ok: false, message: "unsupported service_type" };
}

module.exports = {
  priceCarTransportInternal,
  priceCarTransportExternal,
  priceGasDelivery,
  priceLocalDeliveryFlat,
  computeUnifiedDeliveryFee,
};
