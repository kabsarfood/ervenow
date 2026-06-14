/**
 * تطبيع إحداثيات الطلب للتتبع والخرائط (استلام / تسليم / مزود).
 */

function clampNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

/** نطاق تقريبي للمملكة — يُستخدم لاكتشاف الإحداثيات المقلوبة أو الشاذة */
function isInSaudiBounds(lat, lng) {
  return lat >= 16 && lat <= 33 && lng >= 34 && lng <= 56;
}

function isPlausibleCoord(lat, lng) {
  if (lat == null || lng == null) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return isInSaudiBounds(lat, lng);
}

/** إذا كانت lat/lng مقلوبة لكنها صالحة بعد التبديل داخل السعودية */
function maybeSwapLatLng(lat, lng) {
  if (isPlausibleCoord(lat, lng)) return { lat, lng, swapped: false };
  if (isPlausibleCoord(lng, lat)) return { lat: lng, lng: lat, swapped: true };
  return { lat, lng, swapped: false };
}

function readPoint(obj, latKeys, lngKeys) {
  if (!obj || typeof obj !== "object") return null;
  let lat = null;
  let lng = null;
  for (const k of latKeys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") {
      lat = clampNum(obj[k]);
      if (lat != null) break;
    }
  }
  for (const k of lngKeys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") {
      lng = clampNum(obj[k]);
      if (lng != null) break;
    }
  }
  if (lat == null || lng == null) return null;
  const fixed = maybeSwapLatLng(lat, lng);
  if (!isPlausibleCoord(fixed.lat, fixed.lng)) return null;
  return { lat: fixed.lat, lng: fixed.lng };
}

/**
 * يملأ pickup_* و drop_* على الطلب من الحقول المختلفة (orders + data).
 * @param {object} order
 * @returns {object}
 */
function normalizeOrderTrackingCoords(order) {
  if (!order || typeof order !== "object") return order;
  const d = order.data && typeof order.data === "object" ? order.data : {};

  const pickup =
    readPoint(order, ["pickup_lat"], ["pickup_lng"]) ||
    readPoint(d, ["pickup_lat"], ["pickup_lng"]) ||
    readPoint(d.from_location, ["lat"], ["lng"]) ||
    readPoint(d.from, ["lat"], ["lng"]);

  const drop =
    readPoint(order, ["drop_lat"], ["drop_lng"]) ||
    readPoint(d, ["drop_lat"], ["drop_lng"]) ||
    readPoint(d.to_location, ["lat"], ["lng"]) ||
    readPoint(d.to, ["lat"], ["lng"]);

  if (pickup) {
    order.pickup_lat = pickup.lat;
    order.pickup_lng = pickup.lng;
  }
  if (drop) {
    order.drop_lat = drop.lat;
    order.drop_lng = drop.lng;
  }

  const driver = readPoint(order, ["driver_lat"], ["driver_lng"]);
  if (driver) {
    order.driver_lat = driver.lat;
    order.driver_lng = driver.lng;
  } else if (order.driver_lat != null || order.driver_lng != null) {
    order.driver_lat = null;
    order.driver_lng = null;
  }

  if (!order.pickup_address && (d.from || d.pickup_maps_url || d.from_location?.address)) {
    order.pickup_address = String(d.from || d.pickup_maps_url || d.from_location?.address || "").trim();
  }
  if (!order.drop_address && (d.to || d.drop_maps_url || d.to_location?.address)) {
    order.drop_address = String(d.to || d.drop_maps_url || d.to_location?.address || "").trim();
  }

  const km = clampNum(order.distance_km ?? d.distance_km);
  if (km != null && km > 0 && km <= 800) {
    order.distance_km = Math.round(km * 1000) / 1000;
  } else if (km != null && km > 800) {
    order.distance_km = null;
  }

  return order;
}

function hasValidDriverLocation(order) {
  const lat = clampNum(order && order.driver_lat);
  const lng = clampNum(order && order.driver_lng);
  return isPlausibleCoord(lat, lng);
}

module.exports = {
  isInSaudiBounds,
  isPlausibleCoord,
  maybeSwapLatLng,
  normalizeOrderTrackingCoords,
  hasValidDriverLocation,
};
