/**
 * استعلامات طلبات الخدمة — orders فقط (order_type = service | gas_delivery).
 */

const { breakdownFromOrder } = require("./orderDisplayFields");
const {
  isCarPolishingOrder,
  resolveCpStatus,
  cpStatusLabel,
} = require("./carPolishingWorkflow");
const {
  isServicePhaseOrder,
  resolveSpStatus,
  spStatusLabel,
  subtypeLabel,
} = require("./servicePhaseWorkflow");

const SERVICE_ORDER_TYPES = Object.freeze(["service", "gas_delivery"]);

function isServiceOrderRow(row) {
  if (!row) return false;
  const ot = String(row.order_type || "").toLowerCase();
  return SERVICE_ORDER_TYPES.includes(ot);
}

function bookingStatus(row) {
  return String(row?.delivery_status || row?.status || "new").toLowerCase();
}

/** شكل API متوافق مع الواجهات القديمة (service_bookings) */
function orderToBookingView(order) {
  if (!order) return order;
  const ds = bookingStatus(order);
  const status = ds === "pending" ? "new" : ds;
  const data = order.data && typeof order.data === "object" ? order.data : {};
  const breakdown = breakdownFromOrder(order);
  const service_type =
    String(order.service_type || data.service_type || data.legacy_service_type || "").trim() || order.service_type;
  const district =
    String(order.district || data.pickup_district_label || data.from_city || "").trim() || order.district;
  const out = {
    ...order,
    status,
    service_type,
    district,
    service_order_number: order.order_number || order.service_order_number,
    location:
      order.service_location ||
      order.location ||
      order.drop_address ||
      order.pickup_address ||
      data.pickup_maps_url ||
      "",
    qty: order.service_qty ?? order.qty ?? 1,
  };
  if (Object.keys(breakdown).length) out.breakdown = breakdown;
  if (isCarPolishingOrder(order)) {
    out.cp_status = resolveCpStatus(order);
    out.cp_status_label = cpStatusLabel(out.cp_status);
    out.schedule_mode = data.schedule_mode || "immediate";
    out.vehicle_photos = Array.isArray(data.vehicle_photos) ? data.vehicle_photos : [];
  }
  if (isServicePhaseOrder(order)) {
    out.sp_status = resolveSpStatus(order);
    out.sp_status_label = spStatusLabel(out.sp_status);
    out.schedule_mode = data.schedule_mode || "immediate";
    out.service_subtype = data.service_subtype || null;
    out.service_subtype_label = data.service_subtype
      ? subtypeLabel(service_type, data.service_subtype)
      : null;
    out.service_photos = Array.isArray(data.service_photos) ? data.service_photos : [];
  }
  return out;
}

function mapOrdersToBookings(rows) {
  return (rows || []).map(orderToBookingView);
}

function serviceOrdersQuery(sb) {
  return sb.from("orders").select("*").in("order_type", [...SERVICE_ORDER_TYPES]);
}

function applyServiceTypeFilter(query, types) {
  if (!types || !types.length) return query;
  if (types.length === 1) return query.eq("service_type", types[0]);
  return query.in("service_type", types);
}

async function fetchServiceOrderById(sb, id) {
  const { data, error } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, raw: null, error };
  if (!data || !isServiceOrderRow(data)) {
    return { data: null, raw: null, error: new Error("Not found") };
  }
  return { data: orderToBookingView(data), raw: data, error: null };
}

module.exports = {
  SERVICE_ORDER_TYPES,
  isServiceOrderRow,
  bookingStatus,
  orderToBookingView,
  mapOrdersToBookings,
  serviceOrdersQuery,
  applyServiceTypeFilter,
  fetchServiceOrderById,
};
