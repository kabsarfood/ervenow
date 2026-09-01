/**
 * ERVENOW PAY — خصم محفظة العميل عند checkout، رصيد معلّق للتاجر حتى التسليم.
 */

const { logger } = require("../utils/logger");
const { computePlatformCommission, roundMoney } = require("../utils/platformCommission");
const { computeLedgerWalletFromAllTransactions } = require("../utils/ledgerWallet");

function parseRpcRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function isLegacyInternalDeliveryDoubleFee(order) {
  const st = String(order?.service_type || order?.data?.service_type || "").toLowerCase();
  if (st !== "internal_delivery") return false;
  const sub = Number(order?.order_total) || 0;
  const del = Number(order?.delivery_fee) || 0;
  return sub > 0 && del > 0 && Math.abs(sub - del) < 0.02;
}

function orderChargeAmount(order) {
  const withVat = Number(order?.total_with_vat);
  if (Number.isFinite(withVat) && withVat > 0) return roundMoney(withVat);
  const total = Number(order?.total_amount);
  if (Number.isFinite(total) && total > 0) {
    const sub = Number(order?.order_total) || 0;
    const del = Number(order?.delivery_fee) || 0;
    const vat = Number(order?.vat_amount);
    if (isLegacyInternalDeliveryDoubleFee(order)) {
      if (Number.isFinite(vat) && vat >= 0) return roundMoney(Math.max(sub, del) + vat);
      return roundMoney(Math.max(sub, del) * 1.15);
    }
    if (Number.isFinite(vat) && vat >= 0 && Math.abs(total - (sub + del + vat)) <= 0.05) {
      return roundMoney(total);
    }
    if (!Number.isFinite(vat) || vat <= 0) {
      const expected = roundMoney((sub + del) * 1.15);
      if (Math.abs(total - sub) < 0.02 && del <= 0) return expected;
    }
    return roundMoney(total);
  }
  const sub = Number(order?.order_total) || 0;
  let del = Number(order?.delivery_fee) || 0;
  if (isLegacyInternalDeliveryDoubleFee(order)) del = 0;
  const vat = Number(order?.vat_amount);
  if (Number.isFinite(vat) && vat >= 0) return roundMoney(sub + del + vat);
  return roundMoney((sub + del) * 1.15);
}

function resolveCheckoutGrandTotal(orders, _financialIntent) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const computed = roundMoney(list.reduce((s, o) => s + orderChargeAmount(o), 0));
  if (!(computed > 0)) {
    return { ok: true, amount: 0 };
  }
  return { ok: true, amount: computed };
}

function merchantNetForStoreOrder(order) {
  const goods = Number(order?.order_total) || 0;
  if (!(goods > 0)) return 0;
  return roundMoney(goods - computePlatformCommission(goods));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} storeId
 */
async function resolveMerchantUserIdForStore(sb, storeId) {
  const { resolveStoreMerchantUserId } = require("./platformNotify");
  return resolveStoreMerchantUserId(sb, storeId);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} customerId
 * @param {object[]} orders
 */
async function applyErvenowPayForCheckoutOrders(sb, customerId, orders, options) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  if (!list.length) return { ok: true, paid: [] };

  const opts = options && typeof options === "object" ? options : {};
  const totalResolved = resolveCheckoutGrandTotal(list, opts.financialIntent);
  const totalDue = totalResolved.amount;
  if (!(totalDue > 0)) return { ok: true, paid: [] };

  const custId = String(customerId || "").trim();
  if (!custId) return { ok: false, reason: "missing_customer", message: "معرّف العميل مطلوب" };

  let balance = 0;
  try {
    const ledger = await computeLedgerWalletFromAllTransactions(sb, custId, "customer");
    if (!ledger.ok) {
      if (ledger.reason === "migration_missing") {
        return {
          ok: false,
          reason: "balance_check_failed",
          message: "نظام المحفظة غير مفعّل — تواصل مع دعم ERVENOW",
        };
      }
      const { data: balData, error: balErr } = await sb.rpc("ervenow_ledger_user_wallet_summary", {
        p_user_id: custId,
        p_role: "customer",
      });
      if (balErr) {
        logger.error({ err: balErr.message }, "[ervenowPay] balance check");
        return { ok: false, reason: "balance_check_failed", message: balErr.message || "تعذر التحقق من الرصيد" };
      }
      const balRow = parseRpcRow(balData);
      balance = roundMoney(Number(balRow.balance) || 0);
    } else {
      balance = roundMoney(Number(ledger.balance) || 0);
    }
  } catch (balEx) {
    logger.error({ err: balEx.message || String(balEx) }, "[ervenowPay] balance check");
    return { ok: false, reason: "balance_check_failed", message: "تعذر التحقق من الرصيد" };
  }

  if (balance < totalDue) {
    return {
      ok: false,
      reason: "insufficient_balance",
      message: "رصيد المحفظة غير كافٍ",
      balance,
      required: totalDue,
    };
  }

  const paid = [];
  for (const order of list) {
    const orderId = String(order.id || "").trim();
    const amount = orderChargeAmount(order);
    if (!orderId || !(amount > 0)) continue;

    let merchantUserId = order.merchant_id || null;
    let merchantPending = 0;
    if (order.store_id) {
      if (!merchantUserId) {
        merchantUserId = await resolveMerchantUserIdForStore(sb, order.store_id);
      }
      merchantPending = merchantNetForStoreOrder(order);
    }

    const desc =
      "شراء عبر ERVENOW PAY" +
      (order.order_number ? ` — ${order.order_number}` : orderId ? ` — ${orderId.slice(0, 8)}` : "");

    const { data, error } = await sb.rpc("ervenow_ledger_checkout_ew_pay", {
      p_customer_id: custId,
      p_order_id: orderId,
      p_amount: amount,
      p_merchant_user_id: merchantUserId,
      p_merchant_pending_amount: merchantPending,
      p_description: desc,
    });

    if (error) {
      logger.error({ err: error.message, orderId }, "[ervenowPay] checkout_ew_pay");
      return {
        ok: false,
        reason: "pay_failed",
        message: error.message || "تعذر إتمام الدفع من المحفظة",
        order_id: orderId,
      };
    }

    const row = parseRpcRow(data);
    if (row.ok !== true && row.ok !== "true") {
      const reason = String(row.reason || "pay_failed");
      if (reason === "insufficient_balance") {
        return {
          ok: false,
          reason,
          message: "رصيد المحفظة غير كافٍ",
          balance: row.balance,
        };
      }
      if (reason === "platform_wallet_missing") {
        return {
          ok: false,
          reason,
          message: "نظام الدفع غير مكتمل — تواصل مع دعم ERVENOW",
          order_id: orderId,
        };
      }
      return {
        ok: false,
        reason,
        message: reason === "duplicate" ? "تم الدفع مسبقاً لهذا الطلب" : "تعذر خصم المحفظة",
        order_id: orderId,
      };
    }
    paid.push({ order_id: orderId, amount });
  }

  return { ok: true, paid, total: totalDue };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 */
async function releaseErvenowPayOnOrderComplete(sb, orderId) {
  const id = String(orderId || "").trim();
  if (!id || !sb) return { ok: false, reason: "missing_id" };
  try {
    const { data, error } = await sb.rpc("ervenow_ledger_release_ew_pay_order", { p_order_id: id });
    if (error) {
      logger.warn({ err: error.message, orderId: id }, "[ervenowPay] release");
      return { ok: false, reason: "rpc_error", detail: error.message };
    }
    return parseRpcRow(data);
  } catch (e) {
    logger.warn({ err: e.message || String(e), orderId: id }, "[ervenowPay] release");
    return { ok: false, reason: "exception" };
  }
}

function isErvenowPayMethod(paymentMethod) {
  return String(paymentMethod || "").trim().toLowerCase() === "ew_pay";
}

module.exports = {
  applyErvenowPayForCheckoutOrders,
  releaseErvenowPayOnOrderComplete,
  isErvenowPayMethod,
  orderChargeAmount,
  resolveCheckoutGrandTotal,
  isLegacyInternalDeliveryDoubleFee,
  merchantNetForStoreOrder,
  resolveMerchantUserIdForStore,
};
