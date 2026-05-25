/**
 * حالة الطلب الموحّدة — delivery_status فقط (لا منطق على orders.status).
 */

const { DELIVERY_STATUS } = require("./constants");

/** قيم قديمة تُرفض في الإدخال */
const DEPRECATED_STATUS_ALIASES = Object.freeze({
  onroad: DELIVERY_STATUS.DELIVERING,
  completed: DELIVERY_STATUS.DELIVERED,
  canceled: DELIVERY_STATUS.CANCELLED,
});

/**
 * @param {object} row
 * @returns {string}
 */
function getOrderDeliveryStatus(row) {
  if (!row || typeof row !== "object") return DELIVERY_STATUS.PENDING;
  const ds = row.delivery_status != null ? String(row.delivery_status).trim().toLowerCase() : "";
  if (ds) return ds;
  return DELIVERY_STATUS.PENDING;
}

/**
 * @param {string} raw — من body.status أو body.delivery_status
 */
function normalizeIncomingStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (DEPRECATED_STATUS_ALIASES[s]) return DEPRECATED_STATUS_ALIASES[s];
  if (s === "cancelled_by_customer") return DELIVERY_STATUS.CANCELLED_BY_CUSTOMER;
  return s;
}

/**
 * @param {string} nextStatus — delivery_status موحّد
 */
function buildOrderStatusPatch(nextStatus) {
  const ds = normalizeIncomingStatus(nextStatus);
  const patch = {
    delivery_status: ds,
    updated_at: new Date().toISOString(),
  };
  if (ds === DELIVERY_STATUS.CANCELLED || ds === DELIVERY_STATUS.CANCELLED_BY_CUSTOMER) {
    patch.cancelled_at = new Date().toISOString();
  }
  return patch;
}

function isTerminalOrderStatus(status) {
  const x = String(status || "").toLowerCase();
  return (
    x === DELIVERY_STATUS.DELIVERED ||
    x === DELIVERY_STATUS.CANCELLED ||
    x === DELIVERY_STATUS.CANCELLED_BY_CUSTOMER
  );
}

module.exports = {
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
  buildOrderStatusPatch,
  isTerminalOrderStatus,
  DEPRECATED_STATUS_ALIASES,
};
