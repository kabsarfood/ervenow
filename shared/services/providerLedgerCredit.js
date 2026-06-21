/**
 * إيداع أرباح المزود عند التسليم — ervenow_ledger_credit (idempotent عبر reference_id).
 */

const { getOrderProviderId } = require("../utils/orderProviderId");
const { logger } = require("../utils/logger");

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function orderDataObj(order) {
  return order && order.data && typeof order.data === "object" ? order.data : {};
}

function orderTotalAmount(order) {
  const raw = order?.total_amount ?? order?.order_total;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * مبلغ إيداع المزود — Option A: Ledger Credit = Provider Net
 * @param {object} order
 * @returns {number}
 */
function resolveProviderCreditAmount(order) {
  const data = orderDataObj(order);
  const fromData = Number(data.provider_net);
  if (Number.isFinite(fromData) && fromData > 0) {
    return roundMoney(fromData);
  }

  const total = orderTotalAmount(order);
  const commission = Number(order.platform_commission);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(commission) && commission >= 0) {
    const net = roundMoney(total - commission);
    if (net > 0) return net;
  }

  return Number.isFinite(total) && total > 0 ? roundMoney(total) : NaN;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order — صف orders بعد التسليم
 * @param {string} [context]
 */
async function creditProviderOnDelivered(sb, order, context = "delivered") {
  const orderId = order?.id != null ? String(order.id).trim() : "";
  const providerId = getOrderProviderId(order);
  const amount = resolveProviderCreditAmount(order);

  if (!sb || !orderId) {
    return { ok: false, reason: "missing_order" };
  }
  if (!providerId) {
    return { ok: true, skipped: true, reason: "missing_provider_id" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: true, skipped: true, reason: "missing_credit_amount" };
  }

  try {
    const { data, error } = await sb.rpc("ervenow_ledger_credit", {
      p_user_id: providerId,
      p_amount: amount,
      p_reference: orderId,
      p_role: "service",
      p_reference_suffix: "provider_credit",
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
      return { ...row, amount, credit_basis: "provider_net" };
    }
    logger.warn({ orderId, result: row, context }, "[providerLedgerCredit] not credited");
    return { ...row, amount, credit_basis: "provider_net" };
  } catch (e) {
    const msg = e && (e.message || String(e));
    logger.warn({ orderId, err: msg, context }, "[providerLedgerCredit] exception");
    return { ok: false, reason: "exception", detail: msg };
  }
}

module.exports = {
  creditProviderOnDelivered,
  orderTotalAmount,
  resolveProviderCreditAmount,
  roundMoney,
};
