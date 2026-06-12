const { roughDistanceKm } = require("./geo");

const GAS_RADIUS_INITIAL_KM = 15;
const GAS_RADIUS_EXPANDED_KM = 20;

function gasExpandDelayMs() {
  const mins = Number(process.env.ERVENOW_GAS_RADIUS_EXPAND_MINUTES);
  if (Number.isFinite(mins) && mins > 0) return mins * 60 * 1000;
  return 5 * 60 * 1000;
}

function parseCoordsFromLocation(loc) {
  const parts = String(loc || "")
    .split(",")
    .map((x) => Number(x.trim()));
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function orderData(booking) {
  return booking && booking.data && typeof booking.data === "object" ? booking.data : {};
}

function bookingCustomerCoords(booking) {
  if (!booking) return null;
  const lat = Number(booking.drop_lat ?? booking.pickup_lat);
  const lng = Number(booking.drop_lng ?? booking.pickup_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const d = orderData(booking);
  const lat2 = Number(d.drop_lat ?? d.pickup_lat);
  const lng2 = Number(d.drop_lng ?? d.pickup_lng);
  if (Number.isFinite(lat2) && Number.isFinite(lng2)) return { lat: lat2, lng: lng2 };
  return parseCoordsFromLocation(booking.location || booking.service_location || d.location);
}

function providerCoords(provider) {
  const lat = Number(provider && provider.lat);
  const lng = Number(provider && provider.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function currentGasRadiusKm(booking) {
  const r = Number(orderData(booking).gas_radius_km);
  if (Number.isFinite(r) && r > 0) return r;
  return GAS_RADIUS_INITIAL_KM;
}

function distanceKmBetween(a, b) {
  if (!a || !b) return NaN;
  return roughDistanceKm(a.lat, a.lng, b.lat, b.lng);
}

function providerWithinGasRadius(provider, booking, maxKm) {
  const customer = bookingCustomerCoords(booking);
  if (!customer) return true;
  const coords = providerCoords(provider);
  if (!coords) return false;
  const km = distanceKmBetween(customer, coords);
  return Number.isFinite(km) && km <= maxKm;
}

function notifiedGasPhones(booking) {
  const raw = orderData(booking).gas_notified_phones;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((p) => String(p || "").trim()).filter((p) => p.length >= 10));
}

function isOpenGasBooking(booking) {
  if (!booking) return false;
  if (booking.provider_id || booking.driver_id) return false;
  const ds = String(booking.delivery_status || booking.status || "").toLowerCase();
  return ds === "new" || ds === "pending";
}

function shouldExpandGasRadius(booking, nowMs) {
  if (!isOpenGasBooking(booking)) return false;
  const d = orderData(booking);
  if (d.gas_radius_expanded) return false;
  if (currentGasRadiusKm(booking) >= GAS_RADIUS_EXPANDED_KM) return false;
  const created = Date.parse(String(booking.created_at || ""));
  if (!Number.isFinite(created)) return false;
  return nowMs - created >= gasExpandDelayMs();
}

module.exports = {
  GAS_RADIUS_INITIAL_KM,
  GAS_RADIUS_EXPANDED_KM,
  gasExpandDelayMs,
  parseCoordsFromLocation,
  bookingCustomerCoords,
  providerCoords,
  currentGasRadiusKm,
  distanceKmBetween,
  providerWithinGasRadius,
  notifiedGasPhones,
  isOpenGasBooking,
  shouldExpandGasRadius,
};
