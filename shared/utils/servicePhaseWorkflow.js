/**
 * تدفق مراحل الخدمات المنزلية + أسطوانات الغاز — sp_status داخل orders.data
 * (مرآة cp_status لتلميع المركبات — بدون تغيير مسار gas_central_refill)
 */

const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { isCarPolishingOrder, normalizeScheduleMode } = require("./carPolishingWorkflow");
const { normalizeServiceType } = require("./homeServicePricing");

const SP_STATUS = Object.freeze({
  NEW: "new",
  ACCEPTED: "accepted",
  SCHEDULED: "scheduled",
  ON_THE_WAY: "on_the_way",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

const MAX_SERVICE_PHOTOS = 10;

const SP_STATUS_LABELS = {
  new: "جديدة",
  accepted: "مقبولة",
  scheduled: "مجدولة",
  on_the_way: "في الطريق",
  in_progress: "قيد التنفيذ",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

const SERVICE_SUBTYPES = Object.freeze({
  plumber: [
    { code: "leak_repair", label: "إصلاح تسريب", image: "/assets/services/plumber/leak_repair.png" },
    { code: "unclog", label: "تسليك", image: "/assets/services/plumber/unclog.png" },
    { code: "faucet_install", label: "تركيب خلاط", image: "/assets/services/plumber/faucet_install.png" },
    { code: "toilet_install", label: "تركيب كرسي", image: "/assets/services/plumber/toilet_install.png" },
    { code: "heater_install", label: "تركيب سخان", image: "/assets/services/plumber/heater_install.png" },
    { code: "other", label: "أخرى", image: "/assets/services/plumber/other.png" },
  ],
  electrician: [
    { code: "fault_repair", label: "إصلاح أعطال", image: "/assets/services/electrician/fault_repair.png" },
    { code: "lighting_install", label: "تركيب إنارة", image: "/assets/services/electrician/lighting_install.png" },
    { code: "outlet_install", label: "تركيب أفياش", image: "/assets/services/electrician/outlet_install.png" },
    { code: "breaker_install", label: "تركيب قواطع", image: "/assets/services/electrician/breaker_install.png" },
    { code: "other", label: "أخرى", image: "/assets/services/electrician/other.png" },
  ],
  ac_technician: [
    { code: "cleaning", label: "تنظيف", image: "/assets/services/ac_technician/cleaning.png" },
    { code: "freon_refill", label: "تعبئة فريون", image: "/assets/services/ac_technician/freon_refill.png" },
    { code: "maintenance", label: "صيانة", image: "/assets/services/ac_technician/maintenance.png" },
    { code: "removal", label: "فك", image: "/assets/services/ac_technician/removal.png" },
    { code: "installation", label: "تركيب", image: "/assets/services/ac_technician/installation.png" },
    { code: "removal_install", label: "فك وتركيب", image: "/assets/services/ac_technician/removal_install.png" },
  ],
  agricultural_engineer: [
    { code: "planting", label: "تشجير", image: "/assets/services/agricultural_engineer/planting.png" },
    { code: "tree_trimming", label: "قص أشجار", image: "/assets/services/agricultural_engineer/tree_trimming.png" },
    { code: "irrigation_net", label: "شبكة ري", image: "/assets/services/agricultural_engineer/irrigation_net.png" },
    { code: "garden_design", label: "تنسيق حدائق", image: "/assets/services/agricultural_engineer/garden_design.png" },
    { code: "maintenance", label: "صيانة", image: "/assets/services/agricultural_engineer/maintenance.png" },
  ],
});

const PHASE_HOME_TYPES = new Set([
  "plumber",
  "electrician",
  "ac_technician",
  "agricultural_engineer",
  "nursery",
  "cleaning_villa",
  "cleaning_building",
  "cleaning",
  "laundry_estates",
]);

function orderData(order) {
  return order && order.data && typeof order.data === "object" ? order.data : {};
}

function bookingGasMode(order) {
  const data = orderData(order);
  return String(order?.gas_mode || data.gas_mode || "cylinder_swap").trim().toLowerCase();
}

function isGasCylinderPhaseOrder(order) {
  const st = String(order?.service_type || orderData(order).service_type || "").toLowerCase();
  if (st !== "gas_delivery") return false;
  const mode = bookingGasMode(order);
  return mode !== "central_refill" && mode !== "bulk";
}

function isServicePhaseOrder(order) {
  if (!order) return false;
  if (isCarPolishingOrder(order)) return false;
  if (isGasCylinderPhaseOrder(order)) return true;
  const st = normalizeServiceType(order?.service_type || orderData(order).service_type || "");
  return PHASE_HOME_TYPES.has(st);
}

function normalizeServicePhotos(raw) {
  const out = [];
  const push = (url) => {
    const u = String(url || "").trim();
    if (!u || !/^data:image\//i.test(u)) return;
    if (out.length >= MAX_SERVICE_PHOTOS) return;
    out.push(u);
  };
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") push(item.url);
    });
  }
  return out.slice(0, MAX_SERVICE_PHOTOS);
}

function resolveSpStatus(order) {
  const data = orderData(order);
  if (data.sp_status) return String(data.sp_status).toLowerCase();
  const ds = String(order?.delivery_status || order?.status || "new").toLowerCase();
  if (ds === "cancelled" || ds === "cancelled_by_customer") return SP_STATUS.CANCELLED;
  if (ds === "delivered") return SP_STATUS.COMPLETED;
  if (ds === "delivering") {
    if (data.sp_phase === "in_progress" || data.sp_status === "in_progress") return SP_STATUS.IN_PROGRESS;
    return SP_STATUS.ON_THE_WAY;
  }
  if (ds === "accepted") {
    if (normalizeScheduleMode(data.schedule_mode) === "scheduled" && (data.scheduled_at || order?.scheduled_at)) {
      return SP_STATUS.SCHEDULED;
    }
    return SP_STATUS.ACCEPTED;
  }
  return SP_STATUS.NEW;
}

function spStatusLabel(status) {
  return SP_STATUS_LABELS[String(status || "").toLowerCase()] || status || "—";
}

function subtypeLabel(serviceType, code) {
  const st = normalizeServiceType(serviceType);
  const list = SERVICE_SUBTYPES[st] || [];
  const row = list.find((r) => r.code === String(code || "").trim());
  return row ? row.label : code || "—";
}

function deliveryStatusForSpTransition(spStatus) {
  const s = String(spStatus || "").toLowerCase();
  if (s === SP_STATUS.COMPLETED) return DELIVERY_STATUS.DELIVERED;
  if (s === SP_STATUS.CANCELLED) return DELIVERY_STATUS.CANCELLED;
  if (s === SP_STATUS.ON_THE_WAY || s === SP_STATUS.IN_PROGRESS) return DELIVERY_STATUS.DELIVERING;
  if (s === SP_STATUS.ACCEPTED || s === SP_STATUS.SCHEDULED) return DELIVERY_STATUS.ACCEPTED;
  return DELIVERY_STATUS.NEW;
}

function mergeServicePhaseData(existing, patch) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const sp = base.service_phase && typeof base.service_phase === "object" ? { ...base.service_phase } : {};
  if (patch && typeof patch === "object") {
    Object.assign(sp, patch);
    Object.assign(base, patch);
  }
  base.service_phase = sp;
  if (patch && patch.sp_status) base.sp_status = patch.sp_status;
  return base;
}

function acceptSpStatusFromOrder(data) {
  if (normalizeScheduleMode(data.schedule_mode) === "scheduled" && data.scheduled_at) {
    return SP_STATUS.SCHEDULED;
  }
  return SP_STATUS.ACCEPTED;
}

function subtypesForServiceType(serviceType) {
  const st = normalizeServiceType(serviceType);
  if (st === "nursery") return SERVICE_SUBTYPES.agricultural_engineer || [];
  return SERVICE_SUBTYPES[st] || [];
}

module.exports = {
  SP_STATUS,
  MAX_SERVICE_PHOTOS,
  SP_STATUS_LABELS,
  SERVICE_SUBTYPES,
  PHASE_HOME_TYPES,
  orderData,
  bookingGasMode,
  isGasCylinderPhaseOrder,
  isServicePhaseOrder,
  normalizeServicePhotos,
  normalizeScheduleMode,
  resolveSpStatus,
  spStatusLabel,
  subtypeLabel,
  deliveryStatusForSpTransition,
  mergeServicePhaseData,
  acceptSpStatusFromOrder,
  subtypesForServiceType,
};
