/**
 * طلبات يستلمها مندوب التوصيل (مطاعم / متاجر / توصيل عام / توصيل داخلي).
 * تُستبعد طلبات الخدمات المنزلية ونقل المركبات والأثاث.
 */

const DRIVER_EXCLUDED_ORDER_TYPES = new Set(["service", "gas_delivery"]);

const DRIVER_EXCLUDED_SERVICE_TYPES = new Set([
  "car_transport",
  "pickup_truck",
  "vehicle_transfer",
  "furniture_move",
  "plumber",
  "electrician",
  "ac_technician",
  "laundry_estates",
  "cleaning",
  "cleaning_villa",
  "cleaning_building",
  "nursery",
  "agricultural_engineer",
  "gas_cylinder_swap",
  "gas_central_refill",
  "gas_delivery",
  "car_polishing",
  "service",
]);

function isInternalDeliveryOrder(order) {
  return String(order?.service_type || "").trim().toLowerCase() === "internal_delivery";
}

function isDriverDispatchOrder(order) {
  if (!order) return false;
  if (isInternalDeliveryOrder(order)) return true;
  const ot = String(order.order_type || "delivery").trim().toLowerCase();
  if (DRIVER_EXCLUDED_ORDER_TYPES.has(ot)) return false;
  const st = String(order.service_type || "").trim().toLowerCase();
  if (st && DRIVER_EXCLUDED_SERVICE_TYPES.has(st)) return false;
  return true;
}

function filterDriverDispatchOrders(rows) {
  return (rows || []).filter(isDriverDispatchOrder);
}

module.exports = {
  DRIVER_EXCLUDED_ORDER_TYPES,
  DRIVER_EXCLUDED_SERVICE_TYPES,
  isInternalDeliveryOrder,
  isDriverDispatchOrder,
  filterDriverDispatchOrders,
};
