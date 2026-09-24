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

function isPosEnabled(storeId, file) {
  const id = String(storeId || "").trim();
  if (!id) return false;
  const value = readStores(file)[id];
  if (value === false) return false;
  return true;
}

function setPosEnabled(storeId, enabled, file) {
  const id = String(storeId || "").trim();
  if (!id) throw new Error("store id required");
  const stores = readStores(file);
  stores[id] = !!enabled;
  const target = flagsPath(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ stores }, null, 2));
  return stores[id];
}

function platformOrderIntakeOpen() {
  return true;
}

module.exports = {
  isPosEnabled,
  setPosEnabled,
  platformOrderIntakeOpen,
  flagsPath,
};
