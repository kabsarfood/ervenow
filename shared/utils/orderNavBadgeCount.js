/**
 * عدد شارة الجوال فقط. لا يُرجع صفوف الطلب.
 * العميل والأدمن: count بدون صفوف.
 * المندوب: count واحد بالفلاتر نفسها التي كانت تُطبَّق بعد جلب القائمة.
 */
const {
  DRIVER_EXCLUDED_ORDER_TYPES,
  DRIVER_EXCLUDED_SERVICE_TYPES,
} = require("./driverDispatchOrders");

const CUSTOMER_CLOSED = [
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "canceled",
  "cancelled_by_customer",
  "canceled_by_customer",
];

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function badgeRole(appUser) {
  const role = String((appUser && appUser.role) || "").toLowerCase();
  if (role === "user") return "customer";
  return role;
}

function headCount(sb) {
  return sb.from("orders").select("id", { count: "exact", head: true });
}

function customerOpenFilters(query) {
  const closed = CUSTOMER_CLOSED.join(",");
  return query
    .or(`delivery_status.is.null,delivery_status.not.in.(${closed})`)
    .or("status.is.null,status.not.ilike.*cancel*");
}

function driverDispatchFilter() {
  const types = [...DRIVER_EXCLUDED_ORDER_TYPES].join(",");
  const services = [...DRIVER_EXCLUDED_SERVICE_TYPES].join(",");
  return [
    "service_type.eq.internal_delivery",
    `and(or(order_type.is.null,order_type.not.in.(${types})),or(service_type.is.null,service_type.not.in.(${services})))`,
  ].join(",");
}

async function readCount(query) {
  const { count, error } = await query;
  if (error) {
    const err = new Error(error.message || "badge count failed");
    err.cause = error;
    throw err;
  }
  return Number(count) || 0;
}

async function countNavBadge(sb, appUser) {
  const role = badgeRole(appUser);
  const userId = appUser && appUser.id;
  if (!sb || !role) return 0;

  if (role === "customer") {
    if (!isUuid(userId)) return 0;
    return readCount(customerOpenFilters(headCount(sb).eq("customer_id", userId)));
  }

  if (role === "admin") {
    return readCount(headCount(sb).in("delivery_status", ["new", "pending", "accepted"]));
  }

  if (role === "driver") {
    if (!isUuid(userId)) return 0;
    const assigned = `and(driver_id.is.null,delivery_status.in.(new,pending)),and(driver_id.eq.${userId},delivery_status.in.(new,pending,accepted))`;
    return readCount(headCount(sb).or(assigned).or(driverDispatchFilter()));
  }

  return 0;
}

module.exports = {
  CUSTOMER_CLOSED,
  badgeRole,
  countNavBadge,
  isUuid,
};
