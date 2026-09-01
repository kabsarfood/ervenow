/**
 * P0-03 — استرداد إلغاء الطلب على دفتر ervenow_ledger_* فقط.
 * لا يكتب على ervenow_wallets / wallets القديمة.
 */

function parseRpcRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function isPaidStatus(order) {
  const payStatus = String(order?.payment_status || order?.data?.payment_status || "")
    .trim()
    .toLowerCase();
  return payStatus === "paid" || payStatus === "captured" || payStatus === "completed";
}

function isEwPayMethod(order) {
  return String(order?.payment_method || "")
    .trim()
    .toLowerCase() === "ew_pay";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order
 * @param {string} customerId
 */
async function refundPaidOrderOnLedger(sb, order, customerId) {
  if (!isPaidStatus(order)) return { refunded: false, reason: "not_paid" };
  const orderId = String(order?.id || "").trim();
  const uid = String(customerId || "").trim();
  if (!orderId) return { refunded: false, reason: "no_order_id" };
  if (!uid) return { refunded: false, reason: "customer_not_found" };

  if (!isEwPayMethod(order) && !isPaidStatus(order)) {
    return { refunded: false, reason: "not_paid" };
  }

  const { data, error } = await sb.rpc("ervenow_ledger_refund_cancelled_order", {
    p_order_id: orderId,
    p_customer_id: uid,
  });

  if (error) {
    const msg = String(error.message || error);
    if (/does not exist|schema cache|function.*not found|PGRST202/i.test(msg)) {
      return { refunded: false, reason: "migration_missing", detail: msg };
    }
    return { refunded: false, reason: "refund_rpc_error", detail: msg };
  }

  const row = parseRpcRow(data);
  const reason = String(row.reason || "");
  if (reason === "already_refunded" || reason === "duplicate") {
    return {
      refunded: false,
      reason: "already_refunded",
      amount: Number(row.amount) || 0,
      customer_id: uid,
      idempotent: true,
    };
  }
  if (reason === "already_settled") {
    return { refunded: false, reason: "already_settled", customer_id: uid };
  }
  if (reason === "not_ew_pay" || reason === "no_debit") {
    return { refunded: false, reason: "not_ew_pay" };
  }
  if (row.ok === true || row.ok === "true") {
    return {
      refunded: true,
      amount: Number(row.amount) || 0,
      customer_id: uid,
      reason: reason || "refunded",
      ledger: "ervenow_ledger",
    };
  }
  return { refunded: false, reason: reason || "refund_failed", wallet: row };
}

module.exports = {
  refundPaidOrderOnLedger,
  isPaidStatus,
  isEwPayMethod,
  parseRpcRow,
};
