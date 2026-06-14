/**
 * حساب موحّد لمبالغ الطلب (ERVENOW) — نفس منطق التوصيل: ضريبة 15% على (order_total + delivery_fee).
 * يُستخدم قبل INSERT/UPDATE على جدول orders.
 */

const CAR_TRANSPORT_SERVICE_TYPES = new Set(["car_transport", "pickup_truck", "vehicle_transfer"]);

function getOrderServiceType(order) {
  const st = order?.service_type || order?.data?.service_type || "";
  return String(st).toLowerCase();
}

function hasDoubledCarTransportFee(order) {
  const dfee = Number(order?.delivery_fee) || 0;
  const otot = Number(order?.order_total) || 0;
  if (dfee <= 0) return false;
  if (!CAR_TRANSPORT_SERVICE_TYPES.has(getOrderServiceType(order))) return false;
  return Math.abs(otot - dfee) < 0.02;
}

/**
 * يصحّح طلبات نقل المركبات التي حُفظت بمضاعفة order_total = delivery_fee
 * أو ضريبة/إجمالي لا يطابقان (order_total + delivery_fee).
 */
function repairInconsistentOrderFinancials(order) {
  if (!order || typeof order !== "object") return order;

  let otot = Number(order.order_total) || 0;
  const dfee = Number(order.delivery_fee) || 0;
  if (hasDoubledCarTransportFee(order)) {
    otot = 0;
  }
  const sub = otot + dfee;
  if (sub <= 0) return order;

  const expectedVat = Math.round(sub * 0.15 * 100) / 100;
  const expectedTotal = Math.round((sub + expectedVat) * 100) / 100;
  const vatN = Number(order.vat_amount);
  const twvN = Number(order.total_with_vat);
  const vatMismatch = Number.isFinite(vatN) && Math.abs(vatN - expectedVat) > 0.05;
  const totalMismatch = Number.isFinite(twvN) && Math.abs(twvN - expectedTotal) > 0.05;
  const doubledFee = hasDoubledCarTransportFee(order);

  if (!doubledFee && !vatMismatch && !totalMismatch) return order;

  const out = { ...order };
  if (doubledFee) out.order_total = 0;
  if (doubledFee || vatMismatch) out.vat_amount = expectedVat;
  if (doubledFee || totalMismatch || vatMismatch) {
    out.total_with_vat = expectedTotal;
    if (Object.prototype.hasOwnProperty.call(out, "total_amount")) {
      out.total_amount = expectedTotal;
    }
  }
  return out;
}

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

module.exports = {
  calculateOrderTotals,
  normalizeOrderFinancialsForInsert,
  repairInconsistentOrderFinancials,
  hasDoubledCarTransportFee,
};
