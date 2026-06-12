/**
 * تسعير نقل المركبات (سطحات).
 * داخلي (داخل المدينة): شرائح مسافة + تقديرات 499 ر.س
 * خارجي (بين المدن): 2.30 ر.س/كم · دولي: 2.80 ر.س/كم
 */

function clampNum(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function pricePerKm(distanceKm, rate) {
  const d = Math.max(0, clampNum(distanceKm, 0));
  return Math.round(d * rate * 100) / 100;
}

const CAR_TRANSPORT_APPRAISAL_FEE = 499;
const CAR_TRANSPORT_EXTERNAL_RATE = 2.3;
const CAR_TRANSPORT_INTERNATIONAL_RATE = 2.8;

const CAR_TRANSPORT_INTERNAL_TIERS = [
  { maxKm: 5, fee: 99 },
  { maxKm: 15, fee: 149 },
  { maxKm: 40, fee: 199 },
  { maxKm: 70, fee: 249 },
];

/** نقل داخلي داخل المدينة — شرائح حسب المسافة */
function priceCarTransportInternal(distanceKm, vehicleCondition) {
  const cond = String(vehicleCondition || "").trim().toLowerCase();
  if (cond === "appraisal") {
    return CAR_TRANSPORT_APPRAISAL_FEE;
  }
  const d = Math.max(0, clampNum(distanceKm, 0));
  for (let i = 0; i < CAR_TRANSPORT_INTERNAL_TIERS.length; i += 1) {
    if (d <= CAR_TRANSPORT_INTERNAL_TIERS[i].maxKm) {
      return CAR_TRANSPORT_INTERNAL_TIERS[i].fee;
    }
  }
  return CAR_TRANSPORT_INTERNAL_TIERS[CAR_TRANSPORT_INTERNAL_TIERS.length - 1].fee;
}

/** نقل خارجي بين المدن — 2.30 ر.س/كم */
function priceCarTransportExternal(distanceKm) {
  return pricePerKm(distanceKm, CAR_TRANSPORT_EXTERNAL_RATE);
}

/** نقل دولي — 2.80 ر.س/كم */
function priceCarTransportInternational(distanceKm) {
  return pricePerKm(distanceKm, CAR_TRANSPORT_INTERNATIONAL_RATE);
}

module.exports = {
  CAR_TRANSPORT_APPRAISAL_FEE,
  CAR_TRANSPORT_EXTERNAL_RATE,
  CAR_TRANSPORT_INTERNATIONAL_RATE,
  CAR_TRANSPORT_INTERNAL_TIERS,
  priceCarTransportInternal,
  priceCarTransportExternal,
  priceCarTransportInternational,
};
