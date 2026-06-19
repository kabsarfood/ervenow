/**
 * حقول عرض الطلب — بدون الاعتماد على أعمدة اختيارية في orders
 */

const { parseMissingOrdersColumnFromError } = require("./idempotency");

function orderData(order) {
  return order && order.data && typeof order.data === "object" ? order.data : {};
}

function breakdownFromOrder(order) {
  if (!order) return {};
  const direct = order.breakdown;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }
  const d = orderData(order);
  const nested = d.breakdown;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }
  return {};
}

function orderBreakdown(order) {
  return breakdownFromOrder(order);
}

function storeNameFromOrder(order) {
  if (!order) return null;
  const direct = String(order.store_name || "").trim();
  if (direct) return direct;
  const d = orderData(order);
  const b = orderBreakdown(order);
  const fromPayload = String(d.store_name || d.merchant_name || b.store_name || b.merchant_name || "").trim();
  return fromPayload || null;
}

function isOrdersColumnError(error, column) {
  const missing = parseMissingOrdersColumnFromError(error);
  if (missing) return column ? missing === column : true;
  if (!column) return false;
  return new RegExp(`orders\\.${column}|column[^a-z]*${column}`, "i").test(
    String((error && error.message) || "")
  );
}

function isOrdersStoreNameColumnError(error) {
  return isOrdersColumnError(error, "store_name");
}

function isOrdersBreakdownColumnError(error) {
  return isOrdersColumnError(error, "breakdown");
}

function enrichDriverOrderRow(order) {
  if (!order || typeof order !== "object") return order;
  const store_name = storeNameFromOrder(order);
  const breakdown = breakdownFromOrder(order);
  const hasBreakdown = Object.keys(breakdown).length > 0;
  const out = Object.assign({}, order);
  if (store_name) out.store_name = store_name;
  if (hasBreakdown) out.breakdown = breakdown;
  return out;
}

function enrichDriverOrderRows(rows) {
  return (rows || []).map(enrichDriverOrderRow);
}

module.exports = {
  orderData,
  breakdownFromOrder,
  orderBreakdown,
  storeNameFromOrder,
  isOrdersColumnError,
  isOrdersStoreNameColumnError,
  isOrdersBreakdownColumnError,
  enrichDriverOrderRow,
  enrichDriverOrderRows,
};
