/**
 * Auto Freeze — مرحلتان: تحذير ثم إيقاف (عند mode=AUTO).
 * يستخدم platform_feature_flags.config لـ auto_freeze.
 */

const { createServiceClient } = require("../config/supabase");
const { buildDebtPaymentLink } = require("../utils/debtPaymentLink");
const {
  MODE_OFF,
  MODE_AUTO,
  getFeatureFlags,
  parseAutoFreezeConfig,
} = require("../utils/platformFeatureFlags");
const { isLedgerOnlyMode } = require("../utils/financeMode");
const { getDriverLedgerOwedBalance } = require("../utils/ledgerWallet");

const DEFAULT_WARN = 50;
const DEFAULT_FREEZE = 100;

/**
 * رصيد مديونية المندوب (موجب = مستحق) → رصيد فعّال للمقارنة مع thresholds سالبة.
 * @param {number} balanceOwed
 */
function toAutoFreezeBalance(balanceOwed) {
  const n = Number(balanceOwed) || 0;
  if (n > 0) return -Math.abs(n);
  return n;
}

/**
 * @param {number} balance — الرصيد الفعّال (سالب = دين)
 * @param {object} config — { warn_threshold, freeze_threshold }
 * @param {number} mode — 0|1|2
 */
function evaluateAutoFreezeBalance(balance, config, mode) {
  const m = Number(mode);
  const cfg = parseAutoFreezeConfig(config);
  const b = Number(balance) || 0;

  if (m === MODE_OFF || !Number.isFinite(m)) {
    return { phase: "none", balance: b, ...cfg, mode: m };
  }

  if (m === MODE_AUTO) {
    if (b < -cfg.freeze_threshold) {
      return { phase: "block", balance: b, ...cfg, mode: m };
    }
    if (b < -cfg.warn_threshold) {
      return { phase: "warn", balance: b, ...cfg, mode: m };
    }
    return { phase: "none", balance: b, ...cfg, mode: m };
  }

  return { phase: "none", balance: b, ...cfg, mode: m };
}

const AUTO_FREEZE_BLOCK_MESSAGE = "تم إيقاف حسابك بسبب تجاوز الحد المالي، يرجى السداد";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} driverId — users.id
 * @param {number} [balanceOwed] — رصيد driver_wallets (موجب = دين)
 */
async function getDriverFreezeFlags(sb, driverId, balanceOwed) {
  const features = await getFeatureFlags(sb);
  if (features.auto_freeze !== MODE_AUTO) {
    return { is_frozen: false, warning: false, active: false };
  }

  let owed = balanceOwed;
  if (owed == null && sb && driverId) {
    owed = isLedgerOnlyMode()
      ? await getDriverLedgerOwedBalance(sb, driverId)
      : await require("./driverCommissionLedger").getDriverCommissionBalance(sb, driverId);
  }

  const config = parseAutoFreezeConfig(features.configs?.auto_freeze);
  const state = evaluateAutoFreezeBalance(toAutoFreezeBalance(Number(owed) || 0), config, MODE_AUTO);

  if (state.phase === "warn" || state.phase === "block") {
    const { notifyAutoFreezeDebt } = require("./financialDebtNotify");
    void notifyAutoFreezeDebt(sb, driverId, state.phase, Number(owed) || 0).catch(() => {});
  }

  return {
    active: true,
    is_frozen: state.phase === "block",
    warning: state.phase === "warn",
    phase: state.phase,
    balance_owed: Number(owed) || 0,
    warn_threshold: config.warn_threshold,
    freeze_threshold: config.freeze_threshold,
  };
}

/**
 * بوابة Auto Freeze عند قبول الطلبات — AUTO (mode=2) فقط.
 * @returns {{ blocked: boolean, warning: boolean, message?: string }}
 */
async function applyAutoFreezeGate(sb, driverId, balanceOwed) {
  const flags = await getDriverFreezeFlags(sb, driverId, balanceOwed);
  if (!flags.active) {
    return { blocked: false, warning: false };
  }
  if (flags.is_frozen) {
    return { blocked: true, warning: false, message: AUTO_FREEZE_BLOCK_MESSAGE, ...flags };
  }
  if (flags.warning) {
    return { blocked: false, warning: true, ...flags };
  }
  return { blocked: false, warning: false, ...flags };
}

async function loadAutoFreezeSettings(sb) {
  const client = sb || createServiceClient();
  if (!client) {
    return { mode: 0, config: parseAutoFreezeConfig({}), enabled: false, auto: false };
  }
  const features = await getFeatureFlags(client);
  const config = parseAutoFreezeConfig(features.configs?.auto_freeze);
  const mode = Number(features.auto_freeze) || 0;
  return {
    mode,
    config,
    enabled: mode === MODE_AUTO,
    auto: mode === MODE_AUTO,
  };
}

async function resolveDriverAutoFreeze(sb, driverId, balanceOwed) {
  const settings = await loadAutoFreezeSettings(sb);
  const freezeFlags = await getDriverFreezeFlags(sb, driverId, balanceOwed);
  return {
    ...settings,
    ...freezeFlags,
    phase: freezeFlags.phase || "none",
    driver_id: driverId,
    balance_owed: Number(balanceOwed) || 0,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {Array<object>} drivers
 */
async function enrichDriversWithAutoFreeze(sb, drivers) {
  const list = Array.isArray(drivers) ? drivers : [];
  const settings = await loadAutoFreezeSettings(sb);
  if (!settings.auto) {
    return list.map((d) => ({ ...d, is_frozen: false, warning: false }));
  }

  const userIds = list.map((d) => d.user_id).filter(Boolean);
  const balanceByUser = new Map();
  if (userIds.length) {
    if (isLedgerOnlyMode()) {
      for (const uid of userIds) {
        balanceByUser.set(String(uid), await getDriverLedgerOwedBalance(sb, uid));
      }
    } else {
      const { data: wallets } = await sb
        .from("driver_wallets")
        .select("driver_id, balance")
        .in("driver_id", userIds);
      for (const w of wallets || []) {
        balanceByUser.set(String(w.driver_id), Number(w.balance) || 0);
      }
    }
  }

  return list.map((d) => {
    const uid = d.user_id ? String(d.user_id) : null;
    const bal = uid ? balanceByUser.get(uid) || 0 : 0;
    const state = evaluateAutoFreezeBalance(toAutoFreezeBalance(bal), settings.config, MODE_AUTO);
    return {
      ...d,
      is_frozen: state.phase === "block",
      warning: state.phase === "warn",
    };
  });
}

/**
 * تنبيهات للوحة الأدمن (Financial Alerts).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listAutoFreezeDashboardAlerts(sb) {
  const settings = await loadAutoFreezeSettings(sb);
  if (!settings.auto) return [];

  const alerts = [];
  try {
    let wallets = [];
    if (isLedgerOnlyMode()) {
      const { data, error } = await sb
        .from("ervenow_ledger_wallets")
        .select("user_id, balance")
        .eq("role", "driver")
        .lt("balance", 0)
        .order("balance", { ascending: true })
        .limit(100);
      if (error) {
        if (/ervenow_ledger|does not exist|schema cache/i.test(String(error.message || ""))) return [];
        throw error;
      }
      wallets = (data || []).map((w) => ({
        driver_id: w.user_id,
        balance: Math.abs(Number(w.balance) || 0),
      }));
    } else {
      const { data, error } = await sb
        .from("driver_wallets")
        .select("driver_id, balance")
        .gt("balance", 0)
        .order("balance", { ascending: false })
        .limit(100);

      if (error) {
        if (/driver_wallets|does not exist|schema cache/i.test(String(error.message || ""))) return [];
        throw error;
      }
      wallets = data || [];
    }

    const driverIds = (wallets || []).map((w) => w.driver_id).filter(Boolean);
    const nameById = new Map();
    if (driverIds.length) {
      const { data: users } = await sb.from("users").select("id, phone").in("id", driverIds);
      const { data: drivers } = await sb.from("drivers").select("id, name, phone").limit(500);
      const phoneToDriver = new Map();
      for (const d of drivers || []) {
        if (d.phone) phoneToDriver.set(String(d.phone).replace(/\D/g, ""), d);
      }
      for (const u of users || []) {
        const ph = String(u.phone || "").replace(/\D/g, "");
        const drv = ph ? phoneToDriver.get(ph) : null;
        nameById.set(String(u.id), drv?.name || ph || String(u.id).slice(0, 8));
      }
    }

    for (const w of wallets || []) {
      const uid = String(w.driver_id);
      const bal = Number(w.balance) || 0;
      const state = evaluateAutoFreezeBalance(toAutoFreezeBalance(bal), settings.config, settings.mode);
      if (state.phase === "none") continue;

      const name = nameById.get(uid) || uid.slice(0, 8);
      const payment_link = buildDebtPaymentLink(uid, bal);
      if (state.phase === "block") {
        alerts.push({
          id: `auto_freeze:block:${uid}`,
          type: "auto_freeze_blocked",
          severity: "danger",
          title: "إيقاف مندوب (Auto Freeze)",
          message: `المندوب ${name} — دين ${bal.toFixed(2)} ر.س (حد الإيقاف ${settings.config.freeze_threshold})`,
          user_id: uid,
          amount: bal,
          phase: "block",
          payment_link,
        });
      } else if (state.phase === "warn") {
        alerts.push({
          id: `auto_freeze:warn:${uid}`,
          type: "auto_freeze_warn",
          severity: "warn",
          title: "تحذير دين (Auto Freeze)",
          message: `المندوب ${name} — دين ${bal.toFixed(2)} ر.س (حد التحذير ${settings.config.warn_threshold})`,
          user_id: uid,
          amount: bal,
          phase: "warn",
          payment_link,
        });
      }
    }
  } catch (e) {
    if (/driver_wallets|does not exist|schema cache/i.test(String(e.message || ""))) return [];
    throw e;
  }

  return alerts.slice(0, 20);
}

module.exports = {
  AUTO_FREEZE_BLOCK_MESSAGE,
  DEFAULT_WARN,
  DEFAULT_FREEZE,
  parseAutoFreezeConfig,
  toAutoFreezeBalance,
  evaluateAutoFreezeBalance,
  getDriverFreezeFlags,
  applyAutoFreezeGate,
  loadAutoFreezeSettings,
  resolveDriverAutoFreeze,
  enrichDriversWithAutoFreeze,
  listAutoFreezeDashboardAlerts,
};
