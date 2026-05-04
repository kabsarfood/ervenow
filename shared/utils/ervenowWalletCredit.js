/**
 * محفظة التشغيل (ervenow_wallets / ervenow_wallet_transactions) — إيداع أجر مندوب بعد التسليم.
 * RPC: ervenow_wallet_apply_driver_order_earning — يتطلب migration_ervenow_wallet_atomic_v2.sql
 *
 * المحاسبة العامة (public.wallets + wallet_transactions) منفصلة؛ تُستدعى عبر onDeliveryDelivered → erwenow_finance_settle_order.
 */

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} _driverUserId محجوز للتوافق مع الاستدعاءات
 * @param {object} order صف طلب بعد التسليم (يحتوي id)
 */
async function applyDriverOrderEarning(sb, _driverUserId, order) {
  const orderId = String(order?.id || "").trim();
  if (!orderId) {
    const err = new Error("ervenow_wallet_apply_driver_order_earning: missing order id");
    err.code = "E_WALLET_ORDER_ID";
    throw err;
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
