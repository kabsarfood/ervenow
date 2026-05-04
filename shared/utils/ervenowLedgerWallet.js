/**
 * محفظة الدفتر الموحّد (ervenow_ledger_*) — استدعاءات RPC بعد migration_unified_finance_ledger.sql
 */

function mapAppRoleToLedgerWalletRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "driver") return "driver";
  if (r === "customer") return "customer";
  if (r === "admin") return "admin";
  if (r === "merchant" || r === "restaurant") return "store";
  if (r === "service") return "service";
  return "customer";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function ensureLedgerWalletId(sb, userId, appRole) {
  const p_role = mapAppRoleToLedgerWalletRole(appRole);
  const { data, error } = await sb.rpc("ervenow_ledger_ensure_wallet", {
    p_user_id: userId,
    p_role: p_role,
  });
  if (error) throw error;
  return { walletId: data, ledgerRole: p_role };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function settleDeliveredOrderLedger(sb, orderId) {
  const { data, error } = await sb.rpc("ervenow_ledger_settle_delivered_order", { p_order_id: orderId });
  if (error) throw error;
  const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  if (row.ok === true || row.ok === "true") return row;
  const err = new Error(String(row.reason || "ervenow_ledger_settle_delivered_order failed"));
  err.ledgerResult = row;
  throw err;
}

module.exports = { mapAppRoleToLedgerWalletRole, ensureLedgerWalletId, settleDeliveredOrderLedger };
