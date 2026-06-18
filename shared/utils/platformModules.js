/**
 * Platform Modules Foundation — تشغيل/إيقاف الخدمات من لوحة الأدمن
 * الحالات: enabled | disabled | beta
 */

const fs = require("fs");
const path = require("path");

const MODULE_STATUSES = Object.freeze(["enabled", "disabled", "beta"]);
const filePath = path.join(__dirname, "..", "..", "data", "platform-modules.json");

const DEFAULT_MODULES = Object.freeze({
  meshwar: {
    id: "meshwar",
    label: "Meshwar",
    label_ar: "مشوار",
    description: "خدمة التوصيل السريع Meshwar",
    status: "disabled",
  },
  ervenow_pos: {
    id: "ervenow_pos",
    label: "ERVENOW POS",
    label_ar: "نقاط البيع",
    description: "نظام نقاط البيع للتجار",
    status: "disabled",
  },
  loyalty: {
    id: "loyalty",
    label: "Loyalty",
    label_ar: "الولاء",
    description: "برنامج نقاط الولاء والمكافآت",
    status: "disabled",
  },
  qr_payments: {
    id: "qr_payments",
    label: "QR Payments",
    label_ar: "دفع QR",
    description: "الدفع عبر رمز QR",
    status: "beta",
  },
  service_schedule: {
    id: "service_schedule",
    label: "Service Schedule",
    label_ar: "جدولة الخدمات",
    description: "جدولة المواعيد في بوابة مزوّد الخدمة",
    status: "enabled",
  },
  transport_fleet: {
    id: "transport_fleet",
    label: "Transport Fleet",
    label_ar: "أسطول النقل",
    description: "إدارة مركبات الأسطول في بوابة النقل",
    status: "enabled",
  },
  transport_pricing: {
    id: "transport_pricing",
    label: "Transport Pricing",
    label_ar: "تسعير النقل",
    description: "إدارة أسعار النقل والغاز والمسافات",
    status: "enabled",
  },
});

function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return MODULE_STATUSES.includes(s) ? s : "disabled";
}

function normalizeModuleRow(row, fallbackId) {
  const id = String((row && row.id) || fallbackId || "").trim();
  const base = DEFAULT_MODULES[id] || {
    id,
    label: id,
    label_ar: id,
    description: "",
    status: "disabled",
  };
  return {
    id,
    label: String(row?.label || base.label || id),
    label_ar: String(row?.label_ar || base.label_ar || id),
    description: String(row?.description || base.description || ""),
    status: normalizeStatus(row?.status || base.status),
  };
}

function loadFromFileSync() {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const modules = {};
    const src = parsed.modules && typeof parsed.modules === "object" ? parsed.modules : {};
    for (const id of Object.keys(DEFAULT_MODULES)) {
      modules[id] = normalizeModuleRow(src[id], id);
    }
    for (const id of Object.keys(src)) {
      if (!modules[id]) modules[id] = normalizeModuleRow(src[id], id);
    }
    return {
      updated_at: parsed.updated_at || new Date().toISOString(),
      notes: parsed.notes || "",
      modules,
    };
  } catch {
    return {
      updated_at: new Date().toISOString(),
      notes: "",
      modules: Object.fromEntries(
        Object.entries(DEFAULT_MODULES).map(([id, row]) => [id, normalizeModuleRow(row, id)])
      ),
    };
  }
}

function writeFileSync(state) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    updated_at: new Date().toISOString(),
    notes: state.notes || "Platform Modules — Admin Console",
    modules: state.modules,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function readPlatformModules() {
  return loadFromFileSync();
}

function listPlatformModules() {
  const state = readPlatformModules();
  return Object.values(state.modules || {}).sort((a, b) =>
    String(a.label_ar || a.label).localeCompare(String(b.label_ar || b.label), "ar")
  );
}

function getPlatformModule(moduleId) {
  const state = readPlatformModules();
  const id = String(moduleId || "").trim();
  return state.modules && state.modules[id] ? state.modules[id] : null;
}

function isPlatformModuleEnabled(moduleId) {
  const row = getPlatformModule(moduleId);
  if (!row) return false;
  return row.status === "enabled" || row.status === "beta";
}

function isPlatformModuleBeta(moduleId) {
  const row = getPlatformModule(moduleId);
  return !!(row && row.status === "beta");
}

function updatePlatformModuleStatus(moduleId, status) {
  const id = String(moduleId || "").trim();
  if (!id) throw new Error("module id required");
  const nextStatus = normalizeStatus(status);
  const state = readPlatformModules();
  const current = state.modules[id] || normalizeModuleRow(null, id);
  state.modules[id] = Object.assign({}, current, { id, status: nextStatus });
  return writeFileSync(state);
}

module.exports = {
  MODULE_STATUSES,
  filePath,
  readPlatformModules,
  listPlatformModules,
  getPlatformModule,
  isPlatformModuleEnabled,
  isPlatformModuleBeta,
  updatePlatformModuleStatus,
  DEFAULT_MODULES,
};
