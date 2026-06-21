/** حالات وتدفق طلبات تلميع المركبات (V2) — cp_status داخل orders.data */

const { DELIVERY_STATUS } = require("../domain/orders/constants");

const CP_STATUS = Object.freeze({
  NEW: "new",
  ACCEPTED: "accepted",
  SCHEDULED: "scheduled",
  ON_THE_WAY: "on_the_way",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

const MAX_VEHICLE_PHOTOS = 10;

const PHOTO_SLOT_LABELS = {
  front: "أمامية",
  back: "خلفية",
  side: "جانبية",
  extra: "إضافية",
};

const PROVIDER_REJECT_REASONS = [
  { code: "workload", label: "ضغط عمل" },
  { code: "out_of_area", label: "خارج نطاق الخدمة" },
  { code: "bad_schedule", label: "الموعد غير مناسب" },
  { code: "other", label: "سبب آخر" },
];

const PROVIDER_CANCEL_REASONS = [
  { code: "workload", label: "ضغط عمل" },
  { code: "vehicle_breakdown", label: "عطل مركبة" },
  { code: "emergency", label: "ظرف طارئ" },
  { code: "other", label: "سبب آخر" },
];

const CP_STATUS_LABELS = {
  new: "جديدة",
  accepted: "مقبولة",
  scheduled: "مجدولة",
  on_the_way: "في الطريق",
  in_progress: "قيد التنفيذ",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

function isCarPolishingOrder(order) {
  const st = String(order?.service_type || order?.data?.service_type || "").toLowerCase();
  return st === "car_polishing";
}

function orderData(order) {
  return order && order.data && typeof order.data === "object" ? order.data : {};
}

function rejectedProviderIds(data) {
  const list = Array.isArray(data.rejected_providers) ? data.rejected_providers : [];
  return list
    .map((r) => String((r && r.provider_id) || r || "").trim())
    .filter(Boolean);
}

function providerRejectedOrder(data, providerId) {
  const pid = String(providerId || "").trim();
  if (!pid) return false;
  return rejectedProviderIds(data).includes(pid);
}

function normalizeVehiclePhotosV2(raw) {
  const out = [];
  const push = (slot, url) => {
    const u = String(url || "").trim();
    if (!u || !/^data:image\//i.test(u)) return;
    if (out.length >= MAX_VEHICLE_PHOTOS) return;
    out.push({ slot: slot || "extra", url: u });
  };

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (typeof item === "string") push("extra", item);
      else if (item && typeof item === "object") push(item.slot || "extra", item.url);
    });
  } else if (raw && typeof raw === "object") {
    ["front", "back", "side"].forEach((slot) => {
      if (raw[slot]) push(slot, raw[slot]);
    });
    const extras = raw.extras || raw.extra_photos || [];
    if (Array.isArray(extras)) extras.forEach((u) => push("extra", u));
    else if (typeof extras === "string") push("extra", extras);
  }
  return out.slice(0, MAX_VEHICLE_PHOTOS);
}

function normalizeScheduleMode(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "scheduled" || s === "later" || s === "appointment") return "scheduled";
  return "immediate";
}

function resolveCpStatus(order) {
  const data = orderData(order);
  if (data.cp_status) return String(data.cp_status).toLowerCase();
  const ds = String(order?.delivery_status || "new").toLowerCase();
  if (ds === "cancelled" || ds === "cancelled_by_customer") return CP_STATUS.CANCELLED;
  if (ds === "delivered") return CP_STATUS.COMPLETED;
  if (ds === "delivering") {
    if (data.cp_phase === "in_progress") return CP_STATUS.IN_PROGRESS;
    return CP_STATUS.ON_THE_WAY;
  }
  if (ds === "accepted") {
    if (normalizeScheduleMode(data.schedule_mode) === "scheduled" && data.scheduled_at) {
      return CP_STATUS.SCHEDULED;
    }
    return CP_STATUS.ACCEPTED;
  }
  return CP_STATUS.NEW;
}

function cpStatusLabel(status) {
  return CP_STATUS_LABELS[String(status || "").toLowerCase()] || status || "—";
}

function deliveryStatusForCpTransition(cpStatus) {
  const s = String(cpStatus || "").toLowerCase();
  if (s === CP_STATUS.COMPLETED) return DELIVERY_STATUS.DELIVERED;
  if (s === CP_STATUS.CANCELLED) return DELIVERY_STATUS.CANCELLED;
  if (s === CP_STATUS.ON_THE_WAY || s === CP_STATUS.IN_PROGRESS) return DELIVERY_STATUS.DELIVERING;
  if (s === CP_STATUS.ACCEPTED || s === CP_STATUS.SCHEDULED) return DELIVERY_STATUS.ACCEPTED;
  return DELIVERY_STATUS.NEW;
}

function mergeCarPolishingData(existing, patch) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const cp = base.car_polishing && typeof base.car_polishing === "object" ? { ...base.car_polishing } : {};
  if (patch && typeof patch === "object") {
    Object.assign(cp, patch);
    Object.assign(base, patch);
  }
  base.car_polishing = cp;
  if (patch && patch.cp_status) base.cp_status = patch.cp_status;
  return base;
}

function acceptCpStatusFromOrder(data) {
  if (normalizeScheduleMode(data.schedule_mode) === "scheduled" && data.scheduled_at) {
    return CP_STATUS.SCHEDULED;
  }
  return CP_STATUS.ACCEPTED;
}

function reasonLabel(list, code, fallback) {
  const row = (list || []).find((r) => r.code === code);
  return row ? row.label : fallback || code || "—";
}

module.exports = {
  CP_STATUS,
  MAX_VEHICLE_PHOTOS,
  PHOTO_SLOT_LABELS,
  PROVIDER_REJECT_REASONS,
  PROVIDER_CANCEL_REASONS,
  CP_STATUS_LABELS,
  isCarPolishingOrder,
  orderData,
  rejectedProviderIds,
  providerRejectedOrder,
  normalizeVehiclePhotosV2,
  normalizeScheduleMode,
  resolveCpStatus,
  cpStatusLabel,
  deliveryStatusForCpTransition,
  mergeCarPolishingData,
  acceptCpStatusFromOrder,
  reasonLabel,
};
