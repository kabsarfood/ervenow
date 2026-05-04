/**
 * حساب موحّد لمبالغ الطلب (ERVENOW) — نفس منطق التوصيل: ضريبة 15% على (order_total + delivery_fee).
 * يُستخدم قبل INSERT/UPDATE على جدول orders.
 */

function calculateOrderTotals(order) {
  const subtotal = Number(order.order_total || 0);
  const delivery = Number(order.delivery_fee || 0);
  let vat = Number(order.vat_amount);
  if (!Number.isFinite(vat)) {
    vat = Math.round((subtotal + delivery) * 0.15 * 100) / 100;
  }
  const total = Math.round((subtotal + delivery + vat) * 100) / 100;
  return {
    subtotal,
    delivery,
    vat,
    total_with_vat: total,
  };
}

/**
 * يملأ vat_amount و total_with_vat ويُوحّد order_total من total_amount عند الحاجة.
 * لا يحذف حقولاً أخرى.
 */
function normalizeOrderFinancialsForInsert(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  const otEmpty = out.order_total == null || out.order_total === "";
  const taNum = Number(out.total_amount);
  if (otEmpty && Number.isFinite(taNum) && taNum > 0) {
    out.order_total = taNum;
  }
  const t = calculateOrderTotals(out);
  out.vat_amount = t.vat;
  out.total_with_vat = t.total_with_vat;
  if (Object.prototype.hasOwnProperty.call(out, "total_amount")) {
    out.total_amount = t.total_with_vat;
  }
  return out;
}

module.exports = { calculateOrderTotals, normalizeOrderFinancialsForInsert };
