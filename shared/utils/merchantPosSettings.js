/**
 * إعداد التاجر: استخدام كاشير ERVENOW.
 * الإيقاف يخفي الكاشير فقط. استقبال طلبات المنصة يبقى مفتوحًا دائمًا.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "../../data/merchant-pos-flags.json");

function flagsPath(custom) {
  return custom || DEFAULT_FILE;
}

function readStores(file) {
  try {
    const raw = fs.readFileSync(flagsPath(file), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.stores && typeof parsed.stores === "object") return parsed.stores;
  } catch (_) {
    /* ملف غير موجود = الافتراضي مفعّل */
  }
  return {};
}

function normalizePosSetting(value) {
  if (value === false) return { enabled: false, pos_mode: "A" };
  if (!value || value === true) return { enabled: true, pos_mode: "A" };
  if (typeof value === "object") {
    return {
      enabled: value.enabled !== false,
      pos_mode: String(value.pos_mode || "A").toUpperCase() === "B" ? "B" : "A",
    };
  }
  return { enabled: true, pos_mode: "A" };
}

function readPosSetting(storeId, file) {
  const id = String(storeId || "").trim();
  if (!id) return { enabled: false, pos_mode: "A" };
  return normalizePosSetting(readStores(file)[id]);
}

function writePosSetting(storeId, next, file) {
  const id = String(storeId || "").trim();
  if (!id) throw new Error("store id required");
  const stores = readStores(file);
  const current = normalizePosSetting(stores[id]);
  const merged = {
    enabled: next.enabled == null ? current.enabled : !!next.enabled,
    pos_mode: next.pos_mode == null ? current.pos_mode : next.pos_mode,
  };
  if (merged.pos_mode !== "A" && merged.pos_mode !== "B") {
    const err = new Error("نوع الكاشير C غير متاح الآن");
    err.status = 400;
    throw err;
  }
  stores[id] = merged;
  const target = flagsPath(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ stores }, null, 2));
  return merged;
}

function isPosEnabled(storeId, file) {
  return readPosSetting(storeId, file).enabled;
}

function posMode(storeId, file) {
  return readPosSetting(storeId, file).pos_mode;
}

function setPosEnabled(storeId, enabled, file) {
  return writePosSetting(storeId, { enabled: !!enabled }, file).enabled;
}

function setPosMode(storeId, mode, file) {
  const next = String(mode || "").toUpperCase();
  if (next === "C") {
    const err = new Error("نوع الكاشير C غير متاح الآن");
    err.status = 400;
    throw err;
  }
  if (next !== "A" && next !== "B") {
    const err = new Error("نوع الكاشير يجب أن يكون A أو B");
    err.status = 400;
    throw err;
  }
  return writePosSetting(storeId, { pos_mode: next }, file).pos_mode;
}

function platformOrderIntakeOpen() {
  return true;
}

module.exports = {
  isPosEnabled,
  posMode,
  setPosEnabled,
  setPosMode,
  platformOrderIntakeOpen,
  flagsPath,
};
