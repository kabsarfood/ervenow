const { getOrderDeliveryStatus } = require("./orderStatus");

/**
 * @deprecated استخدم getOrderDeliveryStatus — delivery_status فقط.
 */
function getEffectiveDeliveryStatus(row) {
  return getOrderDeliveryStatus(row);
}

function isTerminalDeliveryStatus(s) {
  const x = String(s || "").toLowerCase();
  return x === DELIVERY_STATUS.DELIVERED || x === DELIVERY_STATUS.CANCELLED || x === DELIVERY_STATUS.CANCELLED_BY_CUSTOMER;
}

module.exports = { getEffectiveDeliveryStatus, isTerminalDeliveryStatus };
