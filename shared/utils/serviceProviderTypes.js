/** أنواع مقدّمي الخدمات — تسجيل، لوحة، ومطابقة الطلبات */
const SERVICE_PROVIDER_OPTIONS = [
  { value: "pickup_truck", label: "نقل مركبات (سطحة)", panelTitle: "لوحة نقل المركبات", icon: "🚗" },
  { value: "electrician", label: "مهندس كهربائي", panelTitle: "لوحة فني الكهرباء", icon: "⚡" },
  { value: "plumber", label: "سباك", panelTitle: "لوحة فني السباكة", icon: "🔧" },
  { value: "ac_technician", label: "فني مكيفات", panelTitle: "لوحة فني المكيفات", icon: "❄️" },
  { value: "laundry_estates", label: "مغسل فلل وعمائر", panelTitle: "لوحة مغسل الفلل والعمائر", icon: "🧼" },
  { value: "furniture_move", label: "نقل أثاث", panelTitle: "لوحة نقل الأثاث", icon: "🛋️" },
  { value: "agricultural_engineer", label: "مهندس زراعي", panelTitle: "لوحة المهندس الزراعي", icon: "🌾" },
  { value: "gas_cylinder_swap", label: "تبديل غاز اسطوانات", panelTitle: "لوحة تبديل غاز الاسطوانات", icon: "🔥" },
  { value: "gas_central_refill", label: "تعبئة غاز مركزي", panelTitle: "لوحة تعبئة الغاز المركزي", icon: "⛽" },
];

const ALLOWED_SERVICE_PROVIDER_TYPES = new Set(SERVICE_PROVIDER_OPTIONS.map((o) => o.value));

/** أنواع الطلبات التي يراها مقدّم الخدمة */
function bookingTypesForProvider(serviceType) {
  const t = String(serviceType || "").trim().toLowerCase();
  if (t === "laundry_estates") {
    return ["laundry_estates", "cleaning_villa", "cleaning_building", "cleaning"];
  }
  if (t === "gas_cylinder_swap" || t === "gas_central_refill") {
    return ["gas_delivery"];
  }
  if (t === "pickup_truck") {
    return ["pickup_truck", "vehicle_transfer", "car_transport"];
  }
  if (!t) return [];
  return [t];
}

function providerGasModeFilter(serviceType) {
  const t = String(serviceType || "").trim().toLowerCase();
  if (t === "gas_cylinder_swap") return "cylinder_swap";
  if (t === "gas_central_refill") return "central_refill";
  return null;
}

function normalizeProviderServiceType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (ALLOWED_SERVICE_PROVIDER_TYPES.has(s)) return s;
  if (s === "cleaning" || s === "cleaning_villa" || s === "cleaning_building") return "laundry_estates";
  if (s === "nursery") return "agricultural_engineer";
  return null;
}

function providerMatchesBookingType(providerType, bookingType, bookingGasMode) {
  const allowed = bookingTypesForProvider(providerType);
  const bt = String(bookingType || "").trim().toLowerCase();
  if (!allowed.includes(bt)) return false;
  const gasFilter = providerGasModeFilter(providerType);
  if (!gasFilter) return true;
  const mode = String(bookingGasMode || "cylinder_swap").trim().toLowerCase();
  if (gasFilter === "cylinder_swap") return mode !== "central_refill";
  return mode === "central_refill";
}

function normDistrictText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه");
}

function districtsMatch(providerDistrict, bookingDistrict) {
  const a = normDistrictText(providerDistrict);
  const b = normDistrictText(bookingDistrict);
  if (!a) return true;
  if (!b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** مطابقة مدينة سائق السطحية مع نص الحي/الموقع في الطلب */
function citiesMatch(providerCity, bookingDistrict, bookingLocation) {
  const city = normDistrictText(providerCity);
  if (!city) return true;
  const hay = normDistrictText(`${bookingDistrict || ""} ${bookingLocation || ""}`);
  if (!hay.trim()) return false;
  return hay.includes(city) || city.includes(hay);
}

function providerAreaMatches(providerType, providerArea, bookingDistrict, bookingLocation) {
  const t = String(providerType || "").trim().toLowerCase();
  if (t === "pickup_truck") {
    return citiesMatch(providerArea, bookingDistrict, bookingLocation);
  }
  return districtsMatch(providerArea, bookingDistrict);
}

function providerAreaLabel(serviceType) {
  return String(serviceType || "").trim().toLowerCase() === "pickup_truck" ? "المدينة" : "الحي";
}

function panelTitleForType(serviceType) {
  const t = String(serviceType || "").trim().toLowerCase();
  const row = SERVICE_PROVIDER_OPTIONS.find((o) => o.value === t);
  return row ? row.panelTitle : "لوحة مزود الخدمة";
}

function labelForType(serviceType) {
  const t = String(serviceType || "").trim().toLowerCase();
  const row = SERVICE_PROVIDER_OPTIONS.find((o) => o.value === t);
  return row ? row.label : serviceType || "مزود خدمة";
}

/** أنواع حسابات مقدّمي الخدمة التي تطابق نوع الطلب */
function providerTypesMatchingBooking(bookingType) {
  const bt = String(bookingType || "").trim().toLowerCase();
  if (!bt) return [];
  const out = new Set();
  for (const row of SERVICE_PROVIDER_OPTIONS) {
    if (bookingTypesForProvider(row.value).includes(bt)) out.add(row.value);
  }
  if (ALLOWED_SERVICE_PROVIDER_TYPES.has(bt)) out.add(bt);
  return [...out];
}

module.exports = {
  SERVICE_PROVIDER_OPTIONS,
  ALLOWED_SERVICE_PROVIDER_TYPES,
  bookingTypesForProvider,
  providerGasModeFilter,
  normalizeProviderServiceType,
  providerMatchesBookingType,
  districtsMatch,
  citiesMatch,
  providerAreaMatches,
  providerAreaLabel,
  normDistrictText,
  panelTitleForType,
  labelForType,
  providerTypesMatchingBooking,
};
