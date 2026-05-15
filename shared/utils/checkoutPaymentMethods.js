/**
 * وسائل الدفع المعروضة في السلة — منصة + (اختياري) متجر أو مزود خدمة.
 * المفاتيح: ew_pay, mada, visa, mastercard, apple_pay, stc_pay, cash_on_delivery, tabby, tamara
 */

const {
  isMissingPlatformSettingsTable,
  platformSettingsHelpMessage,
} = require("./platformBrandingStore");

const METHOD_KEYS = ["ew_pay", "mada", "visa", "mastercard", "apple_pay", "stc_pay", "cash_on_delivery", "tabby", "tamara"];

const DEFAULT_METHODS = Object.freeze({
  ew_pay: true,
  mada: true,
  visa: true,
  mastercard: true,
  apple_pay: true,
  stc_pay: true,
  cash_on_delivery: true,
  tabby: true,
  tamara: true,
});

function cloneDefaults() {
  return { ...DEFAULT_METHODS };
}

function parseMethodsJson(raw) {
  if (raw == null || raw === "") return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return null;
    return o;
  } catch {
    return null;
  }
}

/** يطبّق قيم صريحة true/false فقط على القالب */
function normalizeMethodsPartial(patch) {
  const base = cloneDefaults();
  const p = patch && typeof patch === "object" ? patch : {};
  for (const k of METHOD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, k)) {
      base[k] = !!p[k];
    }
  }
  return base;
}

/** تقاطع: الطريقة تظهر فقط إذا مفعّلة في المنصة وفي كيان الطرف (متجر/مزود) */
function intersectMethods(platformFull, entityPartial) {
  const plat = normalizeMethodsPartial(platformFull);
  const ent = entityPartial ? normalizeMethodsPartial(entityPartial) : cloneDefaults();
  const out = {};
  for (const k of METHOD_KEYS) {
    out[k] = !!plat[k] && !!ent[k];
  }
  return out;
}

function methodsToJsonString(obj) {
  return JSON.stringify(normalizeMethodsPartial(obj));
}

async function loadPlatformPaymentMethodsFromDb(sb) {
  const def = cloneDefaults();
  if (!sb) return normalizeMethodsPartial(def);
  const { data, error } = await sb
    .from("platform_settings")
    .select("value")
    .eq("key", "checkout_payment_methods")
    .maybeSingle();
  if (error || !data || data.value == null || String(data.value).trim() === "") {
    return normalizeMethodsPartial(def);
  }
  return normalizeMethodsPartial(parseMethodsJson(data.value) || def);
}

async function savePlatformPaymentMethodsToDb(sb, obj) {
  if (!sb) throw new Error("قاعدة البيانات غير جاهزة");
  const row = {
    key: "checkout_payment_methods",
    value: methodsToJsonString(obj),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("platform_settings").upsert(row, { onConflict: "key" });
  if (error && isMissingPlatformSettingsTable(error)) {
    throw new Error(platformSettingsHelpMessage(error));
  }
  if (error) throw error;
}

module.exports = {
  METHOD_KEYS,
  DEFAULT_METHODS,
  cloneDefaults,
  parseMethodsJson,
  normalizeMethodsPartial,
  intersectMethods,
  methodsToJsonString,
  loadPlatformPaymentMethodsFromDb,
  savePlatformPaymentMethodsToDb,
};
