/**
 * تسوية التسليم/الإتمام — ledger فقط (ervenow_ledger_settle_*).
 */

const { shadowLedgerSettleDeliveredOrder } = require("./shadowLedger");
const { SETTLEMENT_KINDS, tryClaimSettlement } = require("./settlementGuard");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 * @param {string} [context]
 */
async function settleDeliveredOrderLedgerOnly(sb, orderId, context = "ledger_only:delivered") {
  const id = String(orderId || "").trim();
  if (!id || !sb) return { ok: false, reason: "missing_id" };

  const shouldProceed = await tryClaimSettlement(sb, id, "order", SETTLEMENT_KINDS.LEDGER_DELIVERED, {
    context,
  });
  if (!shouldProceed) {
    return { ok: true, reason: "already_settled", skipped: true };
  }

  return shadowLedgerSettleDeliveredOrder(sb, id, { context });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} bookingId
 * @param {string} [context]
 */
async function settleCompletedServiceLedgerOnly(sb, bookingId, context = "ledger_only:service") {
  const id = String(bookingId || "").trim();
  if (!id || !sb) return { ok: false, reason: "missing_id" };

  const shouldProceed = await tryClaimSettlement(sb, id, "order", SETTLEMENT_KINDS.LEDGER_SERVICE, {
    context,
  });
  if (!shouldProceed) {
    return { ok: true, reason: "already_settled", skipped: true };
  }

  return shadowLedgerSettleDeliveredOrder(sb, id, { type: "service", context });
}

module.exports = { settleDeliveredOrderLedgerOnly, settleCompletedServiceLedgerOnly };
