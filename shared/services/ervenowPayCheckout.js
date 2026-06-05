/**
 * ERVENOW PAY — خصم محفظة العميل عند checkout، رصيد معلّق للتاجر حتى التسليم.
 */

const { logger } = require("../utils/logger");
const { computePlatformCommission, roundMoney } = require("../utils/platformCommission");

function parseRpcRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function orderChargeAmount(order) {
  const withVat = Number(order?.total_with_vat);
  if (Number.isFinite(withVat) && withVat > 0) return roundMoney(withVat);
  const total = Number(order?.total_amount);
  if (Number.isFinite(total) && total > 0) return roundMoney(total);
  const sub = Number(order?.order_total) || 0;
  const del = Number(order?.delivery_fee) || 0;
  const vat = Number(order?.vat_amount);
  if (Number.isFinite(vat) && vat >= 0) return roundMoney(sub + del + vat);
  return roundMoney((sub + del) * 1.15);
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
  const sid = String(storeId || "").trim();
  if (!sid || !sb) return null;
  const { data: storeRow } = await sb.from("stores").select("phone").eq("id", sid).maybeSingle();
  const digits = String(storeRow?.phone || "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  const { data: merchantUser } = await sb
    .from("users")
    .select("id")
    .eq("phone", digits)
    .maybeSingle();
  return merchantUser?.id || null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} customerId
 * @param {object[]} orders
 */
async function applyErvenowPayForCheckoutOrders(sb, customerId, orders) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  if (!list.length) return { ok: true, paid: [] };

  const totalDue = roundMoney(list.reduce((s, o) => s + orderChargeAmount(o), 0));
  if (!(totalDue > 0)) return { ok: true, paid: [] };

  const custId = String(customerId || "").trim();
  if (!custId) return { ok: false, reason: "missing_customer", message: "معرّف العميل مطلوب" };

  const { data: balData, error: balErr } = await sb.rpc("ervenow_ledger_user_wallet_summary", {
    p_user_id: custId,
    p_role: "customer",
  });
  if (balErr) {
    logger.error({ err: balErr.message }, "[ervenowPay] balance check");
    return { ok: false, reason: "balance_check_failed", message: balErr.message || "تعذر التحقق من الرصيد" };
  }
  const balRow = parseRpcRow(balData);
  const balance = roundMoney(Number(balRow.balance) || 0);
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
  merchantNetForStoreOrder,
  resolveMerchantUserIdForStore,
};
