/**
 * مسافة تقريبية بالكيلومتر (درجات → كم) كما في مواصفات المنصة:
 * sqrt((Δlat)² + (Δlng)²) × 111
 */
function roughDistanceKm(lat1, lng1, lat2, lng2) {
  const a = Number(lat1);
  const b = Number(lng1);
  const c = Number(lat2);
  const d = Number(lng2);
  if (![a, b, c, d].every((x) => Number.isFinite(x))) return NaN;
  return Math.sqrt(Math.pow(c - a, 2) + Math.pow(d - b, 2)) * 111;
}

module.exports = { roughDistanceKm };
