const { DELIVERY_STATUS, FINANCE_ORDER_STATUS } = require("./constants");
const { getEffectiveDeliveryStatus, isTerminalDeliveryStatus } = require("./effectiveStatus");
const { canTransitionDeliveryStatus, canTransitionDeliveryStatusLegacy } = require("./transitions");
const {
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
  buildOrderStatusPatch,
  isTerminalOrderStatus,
} = require("./orderStatus");

module.exports = {
  DELIVERY_STATUS,
  FINANCE_ORDER_STATUS,
  getEffectiveDeliveryStatus,
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
  buildOrderStatusPatch,
  isTerminalOrderStatus,
  isTerminalDeliveryStatus,
  canTransitionDeliveryStatus,
  canTransitionDeliveryStatusLegacy,
};
