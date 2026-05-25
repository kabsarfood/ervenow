/**
 * Auto Unfreeze — بعد السداد: إذا effectiveBalance >= -freeze_threshold يُلغى الإيقاف + واتساب.
 */

const { MODE_AUTO, getFeatureFlags, parseAutoFreezeConfig } = require("../utils/platformFeatureFlags");
const { getDriverCommissionBalance } = require("./driverCommissionLedger");
const {
  evaluateAutoFreezeBalance,
  toAutoFreezeBalance,
  loadAutoFreezeSettings,
} = require("./autoFreeze");

/**
 * هل الرصيد يسمح بإلغاء الإيقاف؟ (effective >= -freeze_threshold)
 * @param {number} balanceOwed — موجب = دين على المندوب
 * @param {object} config
 * @param {number} mode
 */
function canAutoUnfreeze(balanceOwed, config, mode) {
  const effective = toAutoFreezeBalance(Number(balanceOwed) || 0);
  const state = evaluateAutoFreezeBalance(effective, config, mode);
  const threshold = -parseAutoFreezeConfig(config).freeze_threshold;
  return {
    effective_balance: effective,
    phase: state.phase,
    meets_threshold: effective >= threshold,
    unfrozen: state.phase !== "block",
    freeze_threshold: parseAutoFreezeConfig(config).freeze_threshold,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {{ payment_amount?: number }} [opts]
 */
async function tryAutoUnfreezeAfterPayment(sb, userId, opts = {}) {
  const uid = String(userId || "").trim();
  if (!uid || !sb) return { ok: false, reason: "invalid_input" };

  const settings = await loadAutoFreezeSettings(sb);
  if (!settings.auto) {
    return { ok: true, active: false, unfrozen: false, reason: "auto_freeze_off" };
  }

  const balanceOwed = await getDriverCommissionBalance(sb, uid);
  const check = canAutoUnfreeze(balanceOwed, settings.config, MODE_AUTO);

  const result = {
    ok: true,
    active: true,
    user_id: uid,
    balance_owed: balanceOwed,
    ...check,
    whatsapp: null,
  };

  if (check.unfrozen && check.meets_threshold && Number(opts.payment_amount) > 0) {
    const { sendUnfreezeWhatsApp } = require("./financialDebtNotify");
    result.whatsapp = await sendUnfreezeWhatsApp(sb, {
      userId: uid,
      amountPaid: Number(opts.payment_amount) || 0,
      balanceOwed,
    });
    if (result.whatsapp?.sent) {
      console.log("[auto_unfreeze] whatsapp sent:", uid.slice(0, 8));
    }
  } else if (!check.unfrozen) {
    console.log("[auto_unfreeze] still blocked:", uid.slice(0, 8), "owed:", balanceOwed);
  }

  return result;
}

module.exports = {
  canAutoUnfreeze,
  tryAutoUnfreezeAfterPayment,
};
