/**
 * تسوية التسليم/الإتمام — ledger فقط. FAIL CLOSED على claim.
 */

const { shadowLedgerSettleDeliveredOrder } = require("./shadowLedger");
const { SETTLEMENT_KINDS, claimSettlement, releaseSettlementClaim } = require("./settlementGuard");

function settleOk(row) {
  return row && (row.ok === true || row.ok === "true");
}

async function settleDeliveredOrderLedgerOnly(sb, orderId, context = "ledger_only:delivered") {
  const id = String(orderId || "").trim();
  if (!id || !sb) return { ok: false, reason: "missing_id" };

  const claim = await claimSettlement(sb, id, "order", SETTLEMENT_KINDS.LEDGER_DELIVERED, { context });
  if (!claim.proceed) {
    if (claim.reason === "already_claimed") {
      return { ok: true, reason: "already_settled", skipped: true };
    }
    return { ok: false, reason: claim.reason, detail: claim.detail || null };
  }

  const row = await shadowLedgerSettleDeliveredOrder(sb, id, { context });
  if (!settleOk(row)) {
    await releaseSettlementClaim(sb, id, "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
  }
  return row;
}

async function settleCompletedServiceLedgerOnly(sb, bookingId, context = "ledger_only:service") {
  const id = String(bookingId || "").trim();
  if (!id || !sb) return { ok: false, reason: "missing_id" };

  const claim = await claimSettlement(sb, id, "order", SETTLEMENT_KINDS.LEDGER_SERVICE, { context });
  if (!claim.proceed) {
    if (claim.reason === "already_claimed") {
      return { ok: true, reason: "already_settled", skipped: true };
    }
    return { ok: false, reason: claim.reason, detail: claim.detail || null };
  }

  const row = await shadowLedgerSettleDeliveredOrder(sb, id, { type: "service", context });
  if (!settleOk(row)) {
    await releaseSettlementClaim(sb, id, "order", SETTLEMENT_KINDS.LEDGER_SERVICE);
  }
  return row;
}

module.exports = { settleDeliveredOrderLedgerOnly, settleCompletedServiceLedgerOnly };
