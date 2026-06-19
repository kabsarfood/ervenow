/**
 * Order Management Board — عدّادات وحسابات مالية للوحة المتجر/المطعم
 */

const { breakdownFromOrder } = require("./orderDisplayFields");

const BOARD_STATUSES = ["pending", "accepted", "preparing", "ready", "picked_up", "delivered"];

function normalizeBoardStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s || s === "cancelled" || s === "cancelled_by_customer") return null;
  if (s === "new" || s === "draft") return "pending";
  if (s === "picked" || s === "delivering") return "picked_up";
  if (BOARD_STATUSES.includes(s)) return s;
  return null;
}

function countOrdersByStatus(orders) {
  const counts = {
    pending: 0,
    accepted: 0,
    preparing: 0,
    ready: 0,
    picked_up: 0,
    delivered: 0,
  };
  for (const o of orders || []) {
    const k = normalizeBoardStatus(o.delivery_status);
    if (k && Object.prototype.hasOwnProperty.call(counts, k)) counts[k]++;
  }
  return counts;
}

function itemsFromOrder(order) {
  const b = breakdownFromOrder(order);
  return Array.isArray(b.items) ? b.items : [];
}

function itemCountFromOrder(order) {
  return itemsFromOrder(order).reduce(function (sum, it) {
    return sum + (Number(it.qty || it.quantity || 1) || 1);
  }, 0);
}

function customerNameFromOrder(order) {
  const b = breakdownFromOrder(order);
  const d = order && order.data && typeof order.data === "object" ? order.data : {};
  return (
    String(b.customer_name || d.customer_name || d.customerName || order.customer_name || "").trim() || "عميل"
  );
}

function financialStatusForOrder(order) {
  const pay = String(order.payment_status || "")
    .trim()
    .toLowerCase();
  const ds = normalizeBoardStatus(order.delivery_status) || String(order.delivery_status || "").toLowerCase();
  if (pay !== "paid") return { key: "pending", label: "معلق" };
  if (ds === "delivered") return { key: "paid", label: "مدفوع" };
  return { key: "due", label: "مستحق" };
}

function enrichOrderForBoard(order) {
  const orderValue = Number(order.total_with_vat != null ? order.total_with_vat : order.order_total) || 0;
  const commission = Number(order.platform_fee) || 0;
  const fin = financialStatusForOrder(order);
  return Object.assign({}, order, {
    item_count: itemCountFromOrder(order),
    customer_name: customerNameFromOrder(order),
    order_value: Math.round(orderValue * 100) / 100,
    commission: Math.round(commission * 100) / 100,
    store_net: Math.round((orderValue - commission) * 100) / 100,
    financial_status: fin.key,
    financial_status_label: fin.label,
    board_status: normalizeBoardStatus(order.delivery_status),
  });
}

module.exports = {
  BOARD_STATUSES,
  normalizeBoardStatus,
  countOrdersByStatus,
  itemsFromOrder,
  itemCountFromOrder,
  customerNameFromOrder,
  financialStatusForOrder,
  enrichOrderForBoard,
};
