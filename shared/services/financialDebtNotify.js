/**
 * إشعارات واتساب للديون — Auto Freeze + Financial Alerts.
 * نفس الرسالة لجميع الأدوار — رابط Pay Link — منع تكرار 6 ساعات.
 */

const { normalizePhone, normalizeDigits } = require("../utils/phone");
const { logger } = require("../utils/logger");
const { sendWhatsApp } = require("../utils/whatsapp");
const {
  buildDebtPaymentLink,
  buildDebtUnfreezeMessage,
  buildDebtNotifyMessage,
  roundAmount,
} = require("../utils/debtPaymentLink");

const { isFeatureAuto, isFeatureEnabled } = require("../utils/platformFeatureFlags");

const CHANNEL = "financial_debt";
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const LEDGER_HIGH_DEBT = -300;

function notifyKindTag(kind) {
  if (kind === "block") return "block";
  if (kind === "unfreeze") return "unfreeze";
  return "warn";
}

function buildLogError(kind, userId) {
  return `kind:${notifyKindTag(kind)};uid:${String(userId || "").trim()}`;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {string} kind — warn | block
 */
async function wasDebtNotifySentRecently(sb, userId, kind) {
  const uid = String(userId || "").trim();
  if (!uid || !sb) return false;

  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const tag = buildLogError(kind, uid);

  try {
    const { data, error } = await sb
      .from("driver_notifications")
      .select("id, error, status, created_at")
      .eq("channel", CHANNEL)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      if (/driver_notifications|does not exist|schema cache/i.test(String(error.message || ""))) {
        return false;
      }
      throw error;
    }

    return (data || []).some((row) => {
      const err = String(row.error || "");
      return err.includes(tag) || (err.includes(`uid:${uid}`) && err.includes(`kind:${notifyKindTag(kind)}`));
    });
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, "[financial_debt] throttle check");
    return false;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 */
async function resolveUserPhone(sb, userId) {
  const uid = String(userId || "").trim();
  if (!uid || !sb) return null;

  const { data: user } = await sb.from("users").select("id, phone, role").eq("id", uid).maybeSingle();
  if (!user?.phone) return null;

  const digits = normalizeDigits(user.phone);
  const phone = normalizePhone(user.phone) || user.phone;

  let driverRecordId = null;
  const { data: drivers } = await sb.from("drivers").select("id, phone").eq("phone", digits).limit(1);
  if (drivers?.[0]?.id) driverRecordId = drivers[0].id;

  return {
    user_id: uid,
    phone,
    phone_digits: digits,
    role: user.role || null,
    driver_record_id: driverRecordId,
  };
}

async function logDebtNotification(sb, row) {
  try {
    await sb.from("driver_notifications").insert(row);
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, "[financial_debt] log notification");
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {{ userId: string, amount: number, kind: "warn"|"block", phone?: string, driverRecordId?: string|null }} opts
 */
async function sendFinancialDebtWhatsApp(sb, opts) {
  const userId = String(opts?.userId || "").trim();
  const kind = opts?.kind === "block" ? "block" : "warn";
  const amount = Number(opts?.amount) || 0;

  if (!userId || amount <= 0) {
    return { ok: false, reason: "invalid_input" };
  }

  if (await wasDebtNotifySentRecently(sb, userId, kind)) {
    return { ok: false, reason: "throttled", throttled: true };
  }

  let phone = opts?.phone || null;
  let driverRecordId = opts?.driverRecordId ?? null;
  if (!phone) {
    const resolved = await resolveUserPhone(sb, userId);
    if (!resolved?.phone) return { ok: false, reason: "no_phone" };
    phone = resolved.phone;
    driverRecordId = driverRecordId || resolved.driver_record_id;
  }

  const paymentLink = buildDebtPaymentLink(userId, amount);
  const message = buildDebtNotifyMessage(kind, amount, paymentLink);

  let sent = false;
  try {
    sent = await sendWhatsApp({ to: phone, message });
    if (sent) {
      console.log("[financial_debt] whatsapp sent:", kind, userId.slice(0, 8));
    }
  } catch (e) {
    logger.warn({ err: e.message || String(e), userId, kind }, "[financial_debt] WA failed");
  }

  await logDebtNotification(sb, {
    order_id: null,
    driver_id: driverRecordId,
    phone: normalizePhone(phone) || normalizeDigits(phone),
    channel: CHANNEL,
    status: sent ? "sent" : "failed",
    error: buildLogError(kind, userId) + (sent ? "" : ";wa_failed"),
    sent_at: sent ? new Date().toISOString() : null,
    attempts: 1,
  });

  return {
    ok: sent,
    sent,
    kind,
    user_id: userId,
    amount: roundAmount(amount),
    payment_link: paymentLink,
    throttled: false,
  };
}

/**
 * ربط Auto Freeze — يُستدعى عند warn/block.
 */
/**
 * رسالة إعادة التفعيل بعد السداد (Auto Unfreeze).
 */
async function sendUnfreezeWhatsApp(sb, opts) {
  const userId = String(opts?.userId || "").trim();
  const amountPaid = Number(opts?.amountPaid) || 0;
  const balanceOwed = Number(opts?.balanceOwed) || 0;

  if (!userId || amountPaid <= 0) return { ok: false, reason: "invalid_input" };

  if (await wasDebtNotifySentRecently(sb, userId, "unfreeze")) {
    return { ok: false, reason: "throttled", throttled: true };
  }

  const resolved = await resolveUserPhone(sb, userId);
  if (!resolved?.phone) return { ok: false, reason: "no_phone" };

  const message = buildDebtUnfreezeMessage(amountPaid, balanceOwed);
  let sent = false;
  try {
    sent = await sendWhatsApp({ to: resolved.phone, message });
    if (sent) console.log("[auto_unfreeze] whatsapp sent:", userId.slice(0, 8));
  } catch (e) {
    logger.warn({ err: e.message || String(e), userId }, "[auto_unfreeze] WA failed");
  }

  await logDebtNotification(sb, {
    order_id: null,
    driver_id: resolved.driver_record_id,
    phone: normalizePhone(resolved.phone) || normalizeDigits(resolved.phone),
    channel: CHANNEL,
    status: sent ? "sent" : "failed",
    error: buildLogError("unfreeze", userId) + (sent ? "" : ";wa_failed"),
    sent_at: sent ? new Date().toISOString() : null,
    attempts: 1,
  });

  return { ok: sent, sent, kind: "unfreeze", user_id: userId, amount_paid: roundAmount(amountPaid) };
}

async function notifyAutoFreezeDebt(sb, userId, phase, balanceOwed) {
  const uid = String(userId || "").trim();
  const owed = Number(balanceOwed) || 0;
  if (!uid || owed <= 0) return { ok: false, reason: "no_debt" };

  if (phase === "warn") {
    console.log("[auto_freeze] warning:", uid);
    return sendFinancialDebtWhatsApp(sb, { userId: uid, amount: owed, kind: "warn" });
  }
  if (phase === "block") {
    console.log("[auto_freeze] blocked:", uid);
    return sendFinancialDebtWhatsApp(sb, { userId: uid, amount: owed, kind: "block" });
  }
  return { ok: false, reason: "no_phase" };
}

/**
 * مسح دفعة لمندوبين ذوي دين (يُستدعى من finance-summary عند AUTO).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function processAutoFreezeDebtNotifications(sb) {
  const { loadAutoFreezeSettings, evaluateAutoFreezeBalance, toAutoFreezeBalance } = require("./autoFreeze");
  const { isLedgerOnlyMode } = require("../utils/financeMode");
  const settings = await loadAutoFreezeSettings(sb);
  if (!settings.auto) return { processed: 0, sent: 0 };

  const minBalance = settings.config.warn_threshold;
  let wallets = [];
  if (isLedgerOnlyMode()) {
    const threshold = -minBalance;
    const { data, error } = await sb
      .from("ervenow_ledger_wallets")
      .select("user_id, balance")
      .eq("role", "driver")
      .lt("balance", threshold)
      .order("balance", { ascending: true })
      .limit(30);
    if (error) {
      if (/ervenow_ledger|does not exist/i.test(String(error.message || ""))) {
        return { processed: 0, sent: 0 };
      }
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
      .gt("balance", minBalance)
      .order("balance", { ascending: false })
      .limit(30);

    if (error) {
      if (/driver_wallets|does not exist/i.test(String(error.message || ""))) {
        return { processed: 0, sent: 0 };
      }
      throw error;
    }
    wallets = data || [];
  }

  let sent = 0;
  for (const w of wallets || []) {
    const uid = String(w.driver_id);
    const bal = Number(w.balance) || 0;
    const state = evaluateAutoFreezeBalance(toAutoFreezeBalance(bal), settings.config, settings.mode);
    if (state.phase !== "warn" && state.phase !== "block") continue;

    const r = await notifyAutoFreezeDebt(sb, uid, state.phase, bal);
    if (r.sent) sent += 1;
  }

  return { processed: (wallets || []).length, sent };
}

/**
 * تنبيهات Smart Financial Alerts — دين ledger عالي.
 */
async function processLedgerHighDebtNotifications(sb) {
  if (!sb) return { processed: 0, sent: 0 };

  const { data: wallets, error } = await sb
    .from("ervenow_ledger_wallets")
    .select("user_id, role, balance")
    .not("user_id", "is", null)
    .lt("balance", LEDGER_HIGH_DEBT)
    .order("balance", { ascending: true })
    .limit(15);

  if (error) {
    if (/ervenow_ledger|does not exist|schema cache/i.test(String(error.message || ""))) {
      return { processed: 0, sent: 0 };
    }
    throw error;
  }

  let sent = 0;
  for (const w of wallets || []) {
    const uid = String(w.user_id);
    const owed = Math.abs(Number(w.balance) || 0);
    if (owed <= 0) continue;
    const r = await sendFinancialDebtWhatsApp(sb, { userId: uid, amount: owed, kind: "warn" });
    if (r.sent) sent += 1;
  }

  return { processed: (wallets || []).length, sent };
}

/**
 * يُستدعى مع finance-summary (دفعة خفيفة، مع throttle 6 ساعات).
 */
async function processDebtNotifyFromFinanceSummary(sb, flags) {
  const out = { auto_freeze: null, ledger_debt: null };
  if (!sb || !flags) return out;

  if (isFeatureAuto(flags.auto_freeze)) {
    out.auto_freeze = await processAutoFreezeDebtNotifications(sb);
  }
  if (isFeatureEnabled(flags.financial_alerts)) {
    out.ledger_debt = await processLedgerHighDebtNotifications(sb);
  }
  return out;
}

module.exports = {
  CHANNEL,
  COOLDOWN_MS,
  buildLogError,
  buildDebtPaymentLink,
  wasDebtNotifySentRecently,
  sendFinancialDebtWhatsApp,
  sendUnfreezeWhatsApp,
  notifyAutoFreezeDebt,
  processAutoFreezeDebtNotifications,
  processLedgerHighDebtNotifications,
  processDebtNotifyFromFinanceSummary,
  resolveUserPhone,
};
