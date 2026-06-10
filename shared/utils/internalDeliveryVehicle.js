/** مطابقة نوع المركبة — توصيل داخلي */

function normalizeVehicleCategory(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (["motorcycle", "bike", "bicycle", "motorbike", "dababa", "دباب", "سكوتر", "scooter", "moped"].includes(s)) {
    return "motorcycle";
  }
  if (["sedan", "car", "سيدان", "سيارة"].includes(s)) {
    return "sedan";
  }
  if (["pickup_truck", "pickup", "ونيت", "truck", "van"].includes(s)) {
    return "pickup_truck";
  }
  return s || "sedan";
}

function vehicleCategoryLabel(v) {
  const c = normalizeVehicleCategory(v);
  if (c === "motorcycle") return "دباب";
  if (c === "pickup_truck") return "ونيت";
  if (c === "sedan") return "سيدان";
  return c || "—";
}

function driverCarTypeForCategory(category) {
  const c = normalizeVehicleCategory(category);
  if (c === "motorcycle") return "bike";
  if (c === "sedan") return "car";
  return null;
}

function serviceUserMatchesVehicleCategory(user, bookingCategory) {
  if (!user) return false;
  const st = String(user.service_type || "").trim().toLowerCase();
  const need = normalizeVehicleCategory(bookingCategory);
  if (st === "pickup_truck") return need === "pickup_truck";
  if (st !== "internal_delivery") return false;
  const vt = String(user.service_vehicle_type || "").trim().toLowerCase();
  if (!vt) return true;
  return normalizeVehicleCategory(vt) === need;
}

function bookingVehicleCategory(booking) {
  const d = booking && booking.data && typeof booking.data === "object" ? booking.data : {};
  return normalizeVehicleCategory(d.vehicle_category || d.vehicle_type || booking?.vehicle_type);
}

module.exports = {
  normalizeVehicleCategory,
  vehicleCategoryLabel,
  driverCarTypeForCategory,
  serviceUserMatchesVehicleCategory,
  bookingVehicleCategory,
};
