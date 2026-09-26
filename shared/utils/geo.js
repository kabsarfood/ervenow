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

/** حركة معتبرة لكتابة الإحداثيات. الثبات تحت العتبة لا يُعدّ تغييراً. */
const PROVIDER_LOCATION_MOVE_METERS = 40;

function providerLocationMeaningfullyMoved(prev, lat, lng, minMeters = PROVIDER_LOCATION_MOVE_METERS) {
  const nextLat = Number(lat);
  const nextLng = Number(lng);
  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return false;
  if (!prev || !Number.isFinite(Number(prev.lat)) || !Number.isFinite(Number(prev.lng))) return true;
  const km = roughDistanceKm(prev.lat, prev.lng, nextLat, nextLng);
  if (!Number.isFinite(km)) return false;
  return km * 1000 >= Number(minMeters);
}

module.exports = {
  roughDistanceKm,
  PROVIDER_LOCATION_MOVE_METERS,
  providerLocationMeaningfullyMoved,
};
