/**
 * إيداع أرباح المزود عند التسليم — ervenow_ledger_credit (idempotent عبر reference_id).
 */

const { getOrderProviderId } = require("../utils/orderProviderId");
const { logger } = require("../utils/logger");

function orderTotalAmount(order) {
  const raw = order?.total_amount ?? order?.order_total;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order — صف orders بعد التسليم
 * @param {string} [context]
 */
async function creditProviderOnDelivered(sb, order, context = "delivered") {
  const orderId = order?.id != null ? String(order.id).trim() : "";
  const providerId = getOrderProviderId(order);
  const amount = orderTotalAmount(order);

  if (!sb || !orderId) {
    return { ok: false, reason: "missing_order" };
  }
  if (!providerId) {
    return { ok: true, skipped: true, reason: "missing_provider_id" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: true, skipped: true, reason: "missing_total_amount" };
  }

  try {
    const { data, error } = await sb.rpc("ervenow_ledger_credit", {
      p_user_id: providerId,
      p_amount: amount,
      p_reference: orderId,
    });

    if (error) {
      const msg = String(error.message || error);
      if (/does not exist|schema cache|function.*not found/i.test(msg)) {
        logger.warn({ orderId, context }, "[providerLedgerCredit] migration missing");
        return { ok: false, reason: "migration_missing", detail: msg };
      }
      logger.warn({ orderId, providerId, err: msg, context }, "[providerLedgerCredit] rpc error");
      return { ok: false, reason: "rpc_error", detail: msg };
    }

    const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    if (row.ok === true || row.ok === "true" || row.reason === "duplicate") {
      return row;
    }
    logger.warn({ orderId, result: row, context }, "[providerLedgerCredit] not credited");
    return row;
  } catch (e) {
    const msg = e && (e.message || String(e));
    logger.warn({ orderId, err: msg, context }, "[providerLedgerCredit] exception");
    return { ok: false, reason: "exception", detail: msg };
  }
}

module.exports = { creditProviderOnDelivered, orderTotalAmount };
