/**
 * إعدادات ERVENOW PAY — platform_settings
 */

const PAY_SETTING_KEYS = Object.freeze([
  "wallet_topup_enabled",
  "wallet_withdraw_enabled",
  "wallet_transfer_enabled",
  "payment_gateways_enabled",
  "stcpay_enabled",
  "mada_enabled",
  "visa_enabled",
  "min_topup_amount",
  "max_topup_amount",
  "stcpay_display_number",
  "wallet_topup_auto_approve",
]);

const DEFAULT_PAY_SETTINGS = Object.freeze({
  wallet_topup_enabled: "true",
  wallet_withdraw_enabled: "false",
  wallet_transfer_enabled: "false",
  payment_gateways_enabled: "false",
  stcpay_enabled: "true",
  mada_enabled: "false",
  visa_enabled: "false",
  min_topup_amount: "30",
  max_topup_amount: "5000",
  stcpay_display_number: String(process.env.ERVENOW_STC_PAY_NUMBER || "0505745650").trim(),
  wallet_topup_auto_approve: "false",
});

function isMissingSettingsTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || err);
  return /platform_settings|does not exist|schema cache|PGRST205|42P01/i.test(msg);
}

function isTruthySetting(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function parseNumberSetting(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePaySettingsMap(rows) {
  const out = { ...DEFAULT_PAY_SETTINGS };
  for (const row of rows || []) {
    const key = String(row.key || "").trim();
    if (PAY_SETTING_KEYS.includes(key) && row.value != null) {
      out[key] = String(row.value);
    }
  }
  return out;
}

function toPublicPaySettings(map) {
  const m = map || DEFAULT_PAY_SETTINGS;
  return {
    wallet_topup_enabled: isTruthySetting(m.wallet_topup_enabled),
    wallet_withdraw_enabled: isTruthySetting(m.wallet_withdraw_enabled),
    wallet_transfer_enabled: isTruthySetting(m.wallet_transfer_enabled),
    payment_gateways_enabled: isTruthySetting(m.payment_gateways_enabled),
    stcpay_enabled: isTruthySetting(m.stcpay_enabled),
    mada_enabled: isTruthySetting(m.mada_enabled),
    visa_enabled: isTruthySetting(m.visa_enabled),
    min_topup_amount: parseNumberSetting(m.min_topup_amount, 30),
    max_topup_amount: parseNumberSetting(m.max_topup_amount, 5000),
    stcpay_display_number: String(m.stcpay_display_number || DEFAULT_PAY_SETTINGS.stcpay_display_number).trim(),
    wallet_topup_auto_approve: isTruthySetting(m.wallet_topup_auto_approve),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function loadPlatformPaySettings(sb) {
  if (!sb) return toPublicPaySettings(DEFAULT_PAY_SETTINGS);
  try {
    const { data, error } = await sb.from("platform_settings").select("key, value").in("key", [...PAY_SETTING_KEYS]);
    if (error) {
      if (isMissingSettingsTable(error)) return toPublicPaySettings(DEFAULT_PAY_SETTINGS);
      throw error;
    }
    return toPublicPaySettings(normalizePaySettingsMap(data));
  } catch (e) {
    if (isMissingSettingsTable(e)) return toPublicPaySettings(DEFAULT_PAY_SETTINGS);
    throw e;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} key
 */
async function getPaySetting(sb, key) {
  const all = await loadPlatformPaySettings(sb);
  const k = String(key || "").trim();
  if (k === "wallet_topup_enabled") return all.wallet_topup_enabled ? "true" : "false";
  if (k === "wallet_withdraw_enabled") return all.wallet_withdraw_enabled ? "true" : "false";
  if (k === "wallet_transfer_enabled") return all.wallet_transfer_enabled ? "true" : "false";
  if (k === "payment_gateways_enabled") return all.payment_gateways_enabled ? "true" : "false";
  if (k === "stcpay_enabled") return all.stcpay_enabled ? "true" : "false";
  if (k === "mada_enabled") return all.mada_enabled ? "true" : "false";
  if (k === "visa_enabled") return all.visa_enabled ? "true" : "false";
  if (k === "min_topup_amount") return String(all.min_topup_amount);
  if (k === "max_topup_amount") return String(all.max_topup_amount);
  if (k === "stcpay_display_number") return all.stcpay_display_number;
  if (k === "wallet_topup_auto_approve") return all.wallet_topup_auto_approve ? "true" : "false";
  return DEFAULT_PAY_SETTINGS[k] ?? null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {Record<string, string|boolean|number>} patch
 */
async function savePlatformPaySettings(sb, patch) {
  if (!sb) throw new Error("قاعدة البيانات غير جاهزة");
  const raw = patch && typeof patch === "object" ? patch : {};
  const now = new Date().toISOString();
  const rows = [];

  for (const key of PAY_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    let value = raw[key];
    if (typeof value === "boolean") value = value ? "true" : "false";
    else value = String(value ?? "").trim();
    rows.push({ key, value, updated_at: now });
  }

  if (!rows.length) return loadPlatformPaySettings(sb);

  for (const row of rows) {
    const { error } = await sb.from("platform_settings").upsert(
      {
        key: row.key,
        value: row.value,
        type: ["min_topup_amount", "max_topup_amount"].includes(row.key) ? "number" : "string",
        updated_at: row.updated_at,
      },
      { onConflict: "key" }
    );
    if (error) {
      if (isMissingSettingsTable(error)) {
        const err = new Error("نفّذ shared/migration_wallet_topup_pay.sql على Supabase");
        err.code = "MIGRATION_MISSING";
        throw err;
      }
      throw error;
    }
  }

  return loadPlatformPaySettings(sb);
}

async function assertTopupEnabled(sb) {
  const settings = await loadPlatformPaySettings(sb);
  if (!settings.wallet_topup_enabled) {
    const err = new Error("خدمة شحن الرصيد غير متاحة حالياً");
    err.statusCode = 403;
    throw err;
  }
  if (!settings.stcpay_enabled) {
    const err = new Error("STC Pay غير متاح حالياً");
    err.statusCode = 403;
    throw err;
  }
  return settings;
}

async function assertWithdrawEnabledPay(sb) {
  const settings = await loadPlatformPaySettings(sb);
  if (!settings.wallet_withdraw_enabled) {
    const err = new Error("السحب غير متاح حالياً");
    err.statusCode = 403;
    throw err;
  }
}

module.exports = {
  PAY_SETTING_KEYS,
  DEFAULT_PAY_SETTINGS,
  isTruthySetting,
  loadPlatformPaySettings,
  getPaySetting,
  savePlatformPaySettings,
  assertTopupEnabled,
  assertWithdrawEnabledPay,
  toPublicPaySettings,
};
