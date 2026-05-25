/**
 * Feature Control — النظام المالي (قابل للتوسع بمفاتيح جديدة).
 * mode: 0 = OFF | 1 = ON (manual) | 2 = AUTO
 */

const FINANCIAL_FEATURE_KEYS = Object.freeze([
  "auto_freeze",
  "auto_payout",
  "financial_alerts",
  "finance_charts",
  "withdraw_system",
]);

const FINANCIAL_FEATURE_LABELS = Object.freeze({
  auto_freeze: "تجميد تلقائي",
  auto_payout: "صرف تلقائي",
  financial_alerts: "تنبيهات مالية",
  finance_charts: "رسوم / مؤشرات مالية",
  withdraw_system: "نظام السحب",
});

const DEFAULT_FINANCIAL_MODES = Object.freeze({
  auto_freeze: 2,
  auto_payout: 2,
  financial_alerts: 2,
  finance_charts: 2,
  withdraw_system: 1,
});

const DEFAULT_AUTO_FREEZE_CONFIG = Object.freeze({
  warn_threshold: 50,
  freeze_threshold: 100,
});

function parseAutoFreezeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  let warn = Number(c.warn_threshold);
  let freeze = Number(c.freeze_threshold);
  if (!Number.isFinite(warn) || warn < 0) warn = DEFAULT_AUTO_FREEZE_CONFIG.warn_threshold;
  if (!Number.isFinite(freeze) || freeze < 0) freeze = DEFAULT_AUTO_FREEZE_CONFIG.freeze_threshold;
  if (freeze <= warn) freeze = warn + 1;
  return { warn_threshold: warn, freeze_threshold: freeze };
}

const MODE_OFF = 0;
const MODE_ON = 1;
const MODE_AUTO = 2;

function isMissingFeatureFlagsTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || err);
  return /platform_feature_flags|does not exist|schema cache|PGRST205|42P01/i.test(msg);
}

function normalizeMode(raw) {
  const n = Number(raw);
  if (n === MODE_OFF || n === MODE_ON || n === MODE_AUTO) return n;
  return MODE_OFF;
}

/** الميزة مفعّلة (ON أو AUTO) */
function isFeatureEnabled(mode) {
  const m = normalizeMode(mode);
  return m === MODE_ON || m === MODE_AUTO;
}

/** السلوك التلقائي الذكي (AUTO فقط) */
function isFeatureAuto(mode) {
  return normalizeMode(mode) === MODE_AUTO;
}

function modeLabel(mode) {
  const m = normalizeMode(mode);
  if (m === MODE_ON) return "ON";
  if (m === MODE_AUTO) return "AUTO";
  return "OFF";
}

function buildFlagsObject(rows) {
  const flags = { ...DEFAULT_FINANCIAL_MODES };
  const configs = {};
  for (const row of rows || []) {
    const key = String(row.key || "").trim();
    if (FINANCIAL_FEATURE_KEYS.includes(key)) {
      flags[key] = normalizeMode(row.mode);
      if (row.config != null && typeof row.config === "object") {
        configs[key] = row.config;
      }
    }
  }
  return { flags, configs };
}

function buildFeaturesList(flags, configs) {
  const cfg = configs || {};
  return FINANCIAL_FEATURE_KEYS.map((key) => ({
    key,
    label: FINANCIAL_FEATURE_LABELS[key] || key,
    mode: normalizeMode(flags[key]),
    mode_label: modeLabel(flags[key]),
    enabled: isFeatureEnabled(flags[key]),
    auto: isFeatureAuto(flags[key]),
    config: key === "auto_freeze" ? parseAutoFreezeConfig(cfg.auto_freeze) : cfg[key] || null,
  }));
}

/** شكل API: [{ key, mode, config? }, ...] */
function toFeatureFlagsArray(flags, configs) {
  const cfg = configs || {};
  return FINANCIAL_FEATURE_KEYS.map((key) => {
    const item = { key, mode: normalizeMode(flags[key]) };
    if (key === "auto_freeze") {
      item.config = parseAutoFreezeConfig(cfg.auto_freeze);
    } else if (cfg[key] != null) {
      item.config = cfg[key];
    }
    return item;
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listFinancialFeatureFlagsArray(sb) {
  const payload = await loadFinancialFeatureFlags(sb);
  return {
    ok: payload.ok,
    reason: payload.reason,
    detail: payload.detail,
    list: toFeatureFlagsArray(payload.flags, payload.configs),
    flags: payload.flags,
    configs: payload.configs,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function loadFinancialFeatureFlags(sb) {
  const flags = { ...DEFAULT_FINANCIAL_MODES };
  const configs = { auto_freeze: { ...DEFAULT_AUTO_FREEZE_CONFIG } };
  if (!sb) {
    return {
      ok: false,
      reason: "missing_client",
      flags,
      configs,
      features: buildFeaturesList(flags, configs),
    };
  }

  try {
    const { data, error } = await sb
      .from("platform_feature_flags")
      .select("key, mode, config, updated_at")
      .in("key", [...FINANCIAL_FEATURE_KEYS]);

    if (error) {
      if (isMissingFeatureFlagsTable(error)) {
        return {
          ok: false,
          reason: "migration_missing",
          flags,
          configs,
          features: buildFeaturesList(flags, configs),
          detail: error.message,
        };
      }
      throw error;
    }

    const merged = buildFlagsObject(data);
    const mergedConfigs = { ...configs, ...merged.configs };
    if (mergedConfigs.auto_freeze) {
      mergedConfigs.auto_freeze = parseAutoFreezeConfig(mergedConfigs.auto_freeze);
    }
    return {
      ok: true,
      flags: merged.flags,
      configs: mergedConfigs,
      features: buildFeaturesList(merged.flags, mergedConfigs),
      source: "platform_feature_flags",
    };
  } catch (e) {
    if (isMissingFeatureFlagsTable(e)) {
      return {
        ok: false,
        reason: "migration_missing",
        flags,
        configs,
        features: buildFeaturesList(flags, configs),
        detail: String(e.message || e),
      };
    }
    throw e;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @returns {Promise<Record<string, number> & { configs: Record<string, object> }>}
 */
async function getFeatureFlags(sb) {
  const loaded = await loadFinancialFeatureFlags(sb);
  return {
    ...loaded.flags,
    configs: loaded.configs || {},
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function getAutoFreezeConfig(sb) {
  const loaded = await loadFinancialFeatureFlags(sb);
  return parseAutoFreezeConfig(loaded.configs?.auto_freeze);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} key
 */
async function getFinancialFeatureMode(sb, key) {
  const k = String(key || "").trim();
  if (!FINANCIAL_FEATURE_KEYS.includes(k)) return DEFAULT_FINANCIAL_MODES[k] ?? MODE_OFF;
  const loaded = await loadFinancialFeatureFlags(sb);
  return normalizeMode(loaded.flags[k]);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} key
 */
async function isFinancialFeatureEnabled(sb, key) {
  return isFeatureEnabled(await getFinancialFeatureMode(sb, key));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} key
 * @param {number} mode
 * @param {object} [config]
 */
async function updateFinancialFeatureFlag(sb, key, mode, config) {
  const k = String(key || "").trim();
  if (!FINANCIAL_FEATURE_KEYS.includes(k)) {
    return { ok: false, reason: "invalid_key", key: k };
  }
  if (!sb) return { ok: false, reason: "missing_client" };

  const m = normalizeMode(mode);
  const row = { key: k, mode: m, updated_at: new Date().toISOString() };
  if (config != null && typeof config === "object" && k === "auto_freeze") {
    row.config = parseAutoFreezeConfig(config);
  }
  try {
    const { data, error } = await sb
      .from("platform_feature_flags")
      .upsert(row, { onConflict: "key" })
      .select("key, mode, config, updated_at")
      .maybeSingle();

    if (error) {
      if (isMissingFeatureFlagsTable(error)) {
        return { ok: false, reason: "migration_missing", detail: error.message };
      }
      throw error;
    }

    console.log("[feature updated]", k, m);

    return {
      ok: true,
      feature: {
        key: k,
        mode: m,
        mode_label: modeLabel(m),
        enabled: isFeatureEnabled(m),
        auto: isFeatureAuto(m),
        config: k === "auto_freeze" ? parseAutoFreezeConfig(data?.config || row.config) : data?.config || null,
        updated_at: data?.updated_at || null,
      },
    };
  } catch (e) {
    if (isMissingFeatureFlagsTable(e)) {
      return { ok: false, reason: "migration_missing", detail: String(e.message || e) };
    }
    throw e;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {Array<{ key?: string, mode?: number }>} updates
 */
async function updateFinancialFeatureFlagsBulk(sb, updates) {
  const results = [];
  for (const row of updates || []) {
    const r = await updateFinancialFeatureFlag(sb, row.key, row.mode, row.config);
    results.push(r);
  }
  const failed = results.find((r) => !r.ok);
  if (failed) return failed;
  const loaded = await loadFinancialFeatureFlags(sb);
  return { ok: true, flags: loaded.flags, features: loaded.features, results };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function assertWithdrawSystemEnabled(sb) {
  const enabled = await isFinancialFeatureEnabled(sb, "withdraw_system");
  if (!enabled) {
    const err = new Error("نظام السحب معطّل حالياً من لوحة التحكم المالي (Feature Control)");
    err.code = "withdraw_system_disabled";
    err.statusCode = 403;
    throw err;
  }
}

module.exports = {
  FINANCIAL_FEATURE_KEYS,
  FINANCIAL_FEATURE_LABELS,
  DEFAULT_FINANCIAL_MODES,
  DEFAULT_AUTO_FREEZE_CONFIG,
  parseAutoFreezeConfig,
  MODE_OFF,
  MODE_ON,
  MODE_AUTO,
  normalizeMode,
  isFeatureEnabled,
  isFeatureAuto,
  modeLabel,
  toFeatureFlagsArray,
  listFinancialFeatureFlagsArray,
  loadFinancialFeatureFlags,
  getFinancialFeatureMode,
  getFeatureFlags,
  getAutoFreezeConfig,
  isFinancialFeatureEnabled,
  updateFinancialFeatureFlag,
  updateFinancialFeatureFlagsBulk,
  assertWithdrawSystemEnabled,
  isMissingFeatureFlagsTable,
};
