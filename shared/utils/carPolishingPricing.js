/** تسعير تلميع المركبات — تلميع داخلي + إضافات اختيارية (ريال سعودي) */

const { computePlatformCommission, PLATFORM_COMMISSION_RATE } = require("./platformCommission");

const VAT_RATE = 0.15;

const VEHICLE_TYPES = ["sedan", "jeep", "van", "bus"];

const BASE_INTERIOR_PRICES = {
  sedan: 280,
  jeep: 350,
  van: 380,
  bus: 420,
};

const ADDON_ENGINE_WASH = 85;
const ADDON_WHEELS = 60;
const ADDON_EXTERIOR = 45;

const VEHICLE_LABELS = {
  sedan: "سيدان",
  jeep: "جيب",
  van: "فان",
  bus: "باص",
};

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function normalizeVehicleType(v) {
  const t = String(v || "")
    .trim()
    .toLowerCase();
  return VEHICLE_TYPES.includes(t) ? t : null;
}

function normalizeBool(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "yes") return true;
  return false;
}

function carPolishingFromPayload(body) {
  const raw = body && typeof body === "object" ? body : {};
  const data = raw.data && typeof raw.data === "object" ? raw.data : raw;
  return {
    vehicle_type: normalizeVehicleType(data.vehicle_type || raw.vehicle_type),
    addon_engine_wash: normalizeBool(data.addon_engine_wash ?? raw.addon_engine_wash),
    addon_wheels: normalizeBool(data.addon_wheels ?? raw.addon_wheels),
    addon_exterior: normalizeBool(data.addon_exterior ?? raw.addon_exterior),
  };
}

function computeCarPolishingBreakdown(input) {
  const vehicle = normalizeVehicleType(input && input.vehicle_type);
  if (!vehicle) {
    return {
      vehicle_type: null,
      base_interior: 0,
      addon_engine_wash: 0,
      addon_wheels: 0,
      addon_exterior: 0,
      total: 0,
    };
  }
  const base = BASE_INTERIOR_PRICES[vehicle] || 0;
  const engine = input.addon_engine_wash ? ADDON_ENGINE_WASH : 0;
  const wheels = input.addon_wheels ? ADDON_WHEELS : 0;
  const exterior = input.addon_exterior ? ADDON_EXTERIOR : 0;
  return {
    vehicle_type: vehicle,
    base_interior: base,
    addon_engine_wash: engine,
    addon_wheels: wheels,
    addon_exterior: exterior,
    total: roundMoney(base + engine + wheels + exterior),
  };
}

function computeCarPolishingTotal(input) {
  return computeCarPolishingBreakdown(input).total;
}

/** عمولة المنصة 7% + ضريبة 15% على مبلغ الخدمة (قبل الضريبة) */
function computeCarPolishingFinancials(input) {
  const breakdown = computeCarPolishingBreakdown(input);
  const subtotal = breakdown.total;
  const platform_commission = computePlatformCommission(subtotal);
  const provider_net = roundMoney(Math.max(0, subtotal - platform_commission));
  const vat_amount = roundMoney(subtotal * VAT_RATE);
  const total_with_vat = roundMoney(subtotal + vat_amount);
  return {
    ...breakdown,
    subtotal_ex_vat: subtotal,
    platform_commission_rate: PLATFORM_COMMISSION_RATE,
    platform_commission,
    provider_net,
    vat_rate: VAT_RATE,
    vat_amount,
    total_with_vat,
  };
}

const {
  normalizeVehiclePhotosV2,
  normalizeScheduleMode,
} = require("./carPolishingWorkflow");

function validateCarPolishingOrder(body) {
  const input = carPolishingFromPayload(body);
  if (!input.vehicle_type) {
    return { ok: false, message: "اختر نوع المركبة", total: 0, breakdown: null };
  }
  const raw = body && typeof body === "object" ? body : {};
  const data = raw.data && typeof raw.data === "object" ? raw.data : raw;
  input.vehicle_photos = normalizeVehiclePhotosV2(data.vehicle_photos || data.photos);
  input.schedule_mode = normalizeScheduleMode(data.schedule_mode || raw.schedule_mode);
  input.scheduled_at = data.scheduled_at || data.execution_time || raw.scheduled_at || null;
  if (input.schedule_mode === "scheduled" && !input.scheduled_at) {
    return { ok: false, message: "اختر تاريخ ووقت الموعد المجدول", total: 0, breakdown: null };
  }
  const breakdown = computeCarPolishingBreakdown(input);
  if (breakdown.total <= 0) {
    return { ok: false, message: "تعذر حساب السعر", total: 0, breakdown: null };
  }
  const financials = computeCarPolishingFinancials(input);
  return { ok: true, message: "", total: breakdown.total, breakdown: financials, input };
}

function carPolishingServiceTitle(vehicleType) {
  const v = normalizeVehicleType(vehicleType);
  return v ? `تلميع المركبات — ${VEHICLE_LABELS[v]}` : "تلميع المركبات";
}

function carPolishingSummaryLines(breakdown) {
  const b = breakdown || {};
  const lines = [];
  if (b.vehicle_type) {
    lines.push(`نوع المركبة: ${VEHICLE_LABELS[b.vehicle_type] || b.vehicle_type}`);
  }
  lines.push("الخدمة الأساسية: تلميع داخلي (مقاعد · سقف · تنظيف داخلي)");
  if (b.addon_engine_wash) lines.push("إضافة: غسيل وتلميع المحرك");
  if (b.addon_wheels) lines.push("إضافة: تلميع الكفرات والجنوط");
  if (b.addon_exterior) lines.push("إضافة: غسيل وتلميع البدي الخارجي");
  return lines;
}

module.exports = {
  VAT_RATE,
  VEHICLE_TYPES,
  BASE_INTERIOR_PRICES,
  ADDON_ENGINE_WASH,
  ADDON_WHEELS,
  ADDON_EXTERIOR,
  VEHICLE_LABELS,
  roundMoney,
  normalizeVehicleType,
  carPolishingFromPayload,
  computeCarPolishingBreakdown,
  computeCarPolishingTotal,
  computeCarPolishingFinancials,
  validateCarPolishingOrder,
  carPolishingServiceTitle,
  carPolishingSummaryLines,
};
