/**
 * Legacy operational driver earning — معطّل في ledger_only.
 */

const { isLedgerOnlyMode } = require("./financeMode");

async function applyDriverOrderEarning(_sb, _driverUserId, order) {
  if (isLedgerOnlyMode()) {
    return { ok: true, reason: "ledger_only_skipped", skipped: true };
  }
  const orderId = String(order?.id || "").trim();
  if (!orderId) {
    const err = new Error("ervenow_wallet_apply_driver_order_earning: missing order id");
    err.code = "E_WALLET_ORDER_ID";
    throw err;
  }

  const { SETTLEMENT_KINDS, tryClaimSettlement } = require("../services/settlementGuard");
  const sb = _sb;

  const shouldProceed = await tryClaimSettlement(sb, orderId, "order", SETTLEMENT_KINDS.OPERATIONAL_EARNING, {});
  if (!shouldProceed) {
    return { ok: true, reason: "already_settled" };
  }

  const { data: rpcData, error: rpcErr } = await sb.rpc("ervenow_wallet_apply_driver_order_earning", {
    p_order_id: orderId,
  });

  if (rpcErr) {
    const err = new Error(rpcErr.message || String(rpcErr));
    err.details = rpcErr;
    throw err;
  }

  const row = typeof rpcData === "object" && rpcData !== null && !Array.isArray(rpcData) ? rpcData : {};
  if (row.ok === true || row.ok === "true") {
    return row;
  }

  const err = new Error(String(row.reason || "ervenow_wallet_apply_driver_order_earning failed"));
  err.walletResult = row;
  throw err;
}

module.exports = { applyDriverOrderEarning };
