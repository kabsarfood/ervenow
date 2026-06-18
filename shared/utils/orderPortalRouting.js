/**
 * ERVENOW Flow Separation 3.0 — Order Routing Engine
 * portal_type: merchant | service | transport
 */

const {
  isTransportPortalType,
  isServicePortalType,
  normServiceType,
} = require("./resolvePortalRole");
const { isDriverDispatchOrder } = require("./driverDispatchOrders");

/** @type {readonly string[]} */
const ORDER_PORTAL_TYPES = ["merchant", "service", "transport"];

const ORDER_PORTAL_TYPE_SET = new Set(ORDER_PORTAL_TYPES);

const MERCHANT_ORDER_TYPES = new Set(["store", "restaurant", "delivery"]);

/**
 * @param {object|null|undefined} order
 * @returns {"merchant"|"service"|"transport"|null}
 */
function resolveOrderPortalType(order) {
  if (!order) return null;

  const explicit = String(order.portal_type || "").trim().toLowerCase();
  if (ORDER_PORTAL_TYPE_SET.has(explicit)) return explicit;

  const dataPortal = order.data && typeof order.data === "object" ? order.data.portal_type : null;
  const fromData = String(dataPortal || "").trim().toLowerCase();
  if (ORDER_PORTAL_TYPE_SET.has(fromData)) return fromData;

  const ot = String(order.order_type || "").trim().toLowerCase();
  const st = normServiceType(order.service_type);

  if (ot === "service" || ot === "gas_delivery") {
    if (isTransportPortalType(st)) return "transport";
    if (isServicePortalType(st) || !st) return "service";
    return "service";
  }

  if (MERCHANT_ORDER_TYPES.has(ot) || order.store_id) return "merchant";

  if (st && isTransportPortalType(st)) return "transport";
  if (st && isServicePortalType(st)) return "service";

  return "merchant";
}

/**
 * @param {object} row
 * @returns {object}
 */
function applyPortalTypeToOrderRow(row) {
  const portal_type = resolveOrderPortalType(row);
  const base = row && typeof row === "object" ? { ...row } : {};
  const data =
    base.data && typeof base.data === "object" && !Array.isArray(base.data)
      ? { ...base.data, portal_type }
      : { portal_type };
  return { ...base, portal_type, data };
}

/**
 * @param {object} order
 * @param {string} portalType — merchant | driver | service | transport | customer | admin
 * @returns {boolean}
 */
function orderVisibleInPortal(order, portalType) {
  const portal = String(portalType || "").trim().toLowerCase();
  const ownerPortal = resolveOrderPortalType(order);

  if (portal === "customer" || portal === "admin") return true;
  if (portal === "merchant") return ownerPortal === "merchant";
  if (portal === "service") return ownerPortal === "service";
  if (portal === "transport") return ownerPortal === "transport";
  if (portal === "driver") {
    if (ownerPortal !== "merchant") return false;
    return isDriverDispatchOrder(order);
  }
  return false;
}

/**
 * @param {object[]} orders
 * @param {string} portalType
 * @returns {object[]}
 */
function filterOrdersForPortal(orders, portalType) {
  return (orders || []).filter((o) => orderVisibleInPortal(o, portalType));
}

module.exports = {
  ORDER_PORTAL_TYPES,
  ORDER_PORTAL_TYPE_SET,
  resolveOrderPortalType,
  applyPortalTypeToOrderRow,
  orderVisibleInPortal,
  filterOrdersForPortal,
};
