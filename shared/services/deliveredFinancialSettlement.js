/**
 * تسوية مالية عند التسليم — مصدر واحد لأجر المندوب (ervenow_ledger_settle_delivered_order).
 */

const { getOrderProviderId } = require("../utils/orderProviderId");
const { logger } = require("../utils/logger");
const { SETTLEMENT_KINDS, tryClaimSettlement } = require("./settlementGuard");

function parseRpcRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function orderTotalAmount(order) {
  const raw = order?.total_amount ?? order?.order_total;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order — صف orders بعد delivered
 * @param {string} [context]
 */
async function runDeliveredFinancialSettlement(sb, order, context = "unified:delivered") {
  const orderId = order?.id != null ? String(order.id).trim() : "";
  if (!sb || !orderId) {
    return { settlement: { ok: false, reason: "missing_order" }, provider_credit: null };
  }

  let settlementRow = { ok: true, reason: "already_settled", skipped: true };

  const shouldProceed = await tryClaimSettlement(sb, orderId, "order", SETTLEMENT_KINDS.LEDGER_DELIVERED, {
    context,
  });

  if (shouldProceed) {
    try {
      const { data, error } = await sb.rpc("ervenow_ledger_settle_delivered_order", {
        p_order_id: orderId,
      });
      if (error) {
        const msg = String(error.message || error);
        if (/does not exist|schema cache|function.*not found/i.test(msg)) {
          logger.warn({ orderId, context }, "[deliveredFinancialSettlement] ledger migration missing");
          settlementRow = { ok: false, reason: "migration_missing", detail: msg };
        } else {
          logger.warn({ orderId, err: msg, context }, "[deliveredFinancialSettlement] settle rpc error");
          settlementRow = { ok: false, reason: "rpc_error", detail: msg };
        }
      } else {
        settlementRow = parseRpcRow(data);
      }
    } catch (e) {
      const msg = e && (e.message || String(e));
      logger.warn({ orderId, err: msg, context }, "[deliveredFinancialSettlement] settle exception");
      settlementRow = { ok: false, reason: "exception", detail: msg };
    }
  }

  let providerCreditRow = null;
  const providerId = getOrderProviderId(order);
  if (providerId) {
    const amount = orderTotalAmount(order);
    if (Number.isFinite(amount) && amount > 0) {
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
          logger.warn({ orderId, providerId, err: msg }, "[deliveredFinancialSettlement] provider credit");
          providerCreditRow = { ok: false, reason: "rpc_error", detail: msg };
        } else {
          providerCreditRow = parseRpcRow(data);
        }
      } catch (e) {
        providerCreditRow = { ok: false, reason: "exception", detail: e && (e.message || String(e)) };
      }
    } else {
      providerCreditRow = { ok: true, skipped: true, reason: "missing_total_amount" };
    }
  }

  return { settlement: settlementRow, provider_credit: providerCreditRow };
}

module.exports = { runDeliveredFinancialSettlement };
