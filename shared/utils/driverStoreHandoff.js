/**
 * تمييز طلبات المتجر/المطعم عن التوصيل العام في مسار المندوب.
 */

const STORE_ORDER_TYPES = new Set(["store", "restaurant"]);

function isMerchantDispatchOrder(order) {
  if (!order) return false;
  const ot = String(order.order_type || "")
    .trim()
    .toLowerCase();
  return STORE_ORDER_TYPES.has(ot) || !!order.store_id;
}

function normalizeDriverStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "picked") return "picked_up";
  return s;
}

/** طلبات pending/new للمندوب — استبعاد متجر/مطعم (تنتظر ready) */
function isLegacyOpenOrderForDriver(order) {
  if (!order || order.driver_id) return false;
  const ds = normalizeDriverStatus(order.delivery_status || order.status);
  if (ds !== "new" && ds !== "pending") return false;
  return !isMerchantDispatchOrder(order);
}

/** طلبات جاهزة للاستلام من المتجر */
function isReadyQueueOrderForDriver(order) {
  if (!order || order.driver_id) return false;
  if (normalizeDriverStatus(order.delivery_status || order.status) !== "ready") return false;
  return isMerchantDispatchOrder(order);
}

/** طلبات نشطة للمندوب المعيّن */
function isActiveAssignedOrderForDriver(order, driverUserId) {
  if (!order || !driverUserId) return false;
  if (String(order.driver_id || "") !== String(driverUserId)) return false;
  const ds = normalizeDriverStatus(order.delivery_status || order.status);
  return ds === "accepted" || ds === "picked_up" || ds === "delivering";
}

function isCompletedOrderForDriver(order, driverUserId) {
  if (!order || !driverUserId) return false;
  if (String(order.driver_id || "") !== String(driverUserId)) return false;
  return normalizeDriverStatus(order.delivery_status || order.status) === "delivered";
}

module.exports = {
  STORE_ORDER_TYPES,
  isMerchantDispatchOrder,
  normalizeDriverStatus,
  isLegacyOpenOrderForDriver,
  isReadyQueueOrderForDriver,
  isActiveAssignedOrderForDriver,
  isCompletedOrderForDriver,
};
