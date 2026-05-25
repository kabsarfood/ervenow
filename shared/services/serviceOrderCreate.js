/**
 * إنشاء طلب خدمة — orders فقط (order_type = service | gas_delivery).
 */

const { allocateUniqueServiceOrderNumber } = require("../utils/generateOrderNumber");
const { insertOrdersResilient } = require("../utils/idempotency");
const { computePlatformCommission } = require("../utils/serviceCommission");
const { isHomeServiceType } = require("../utils/homeServicePricing");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { notifyProvidersForBooking } = require("./serviceBookingNotify");
const { logger } = require("../utils/logger");

const SERVICE_ORDER_TYPES = new Set([
  "service",
  "plumber",
  "electrician",
  "nursery",
  "agricultural_engineer",
  "ac_technician",
  "cleaning",
  "cleaning_villa",
  "cleaning_building",
  "laundry_estates",
  "vehicle_transfer",
  "internal_delivery",
  "pickup_truck",
  "furniture_move",
  "gas_delivery",
]);

function isServiceOrderType(type) {
  return SERVICE_ORDER_TYPES.has(String(type || "").trim().toLowerCase());
}

function resolveOrderType(serviceType) {
  const st = String(serviceType || "service").trim().toLowerCase();
  return st === "gas_delivery" ? "gas_delivery" : "service";
}

function normalizeQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
}

function normalizeMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} appUser
 * @param {object} body
 */
async function createServiceOrder(sb, appUser, body) {
  const raw = body && typeof body === "object" ? body : {};
  const serviceType = String(raw.service_type || raw.type || "service").trim().toLowerCase();
  if (!isServiceOrderType(serviceType) && !isHomeServiceType(serviceType)) {
    return { ok: false, status: 400, message: "invalid service_type" };
  }

  const total = normalizeMoney(raw.total_amount ?? raw.total ?? raw.price);
  const orderType = resolveOrderType(serviceType);
  const platformCommission = normalizeMoney(
    raw.platform_commission ?? computePlatformCommission(total, serviceType)
  );
  const paymentStatus = String(raw.payment_status || "unpaid").toLowerCase() === "paid" ? "paid" : "unpaid";
  const providerId = raw.provider_id || raw.service_provider_id || null;
  const location = String(raw.location || raw.service_location || raw.drop_address || "").trim();
  const district = String(raw.district || "").trim();

  let orderData = null;
  let insertErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const order_number = await allocateUniqueServiceOrderNumber(sb, orderType === "gas_delivery" ? "ES" : "SV");
    const row = {
      customer_id: appUser.id,
      customer_phone: String(appUser.phone || raw.customer_phone || "").trim(),
      order_type: orderType,
      service_type: serviceType,
      service_name: String(raw.service_name || raw.title || serviceType).trim(),
      provider_id: providerId,
      service_provider_id: providerId,
      delivery_status: DELIVERY_STATUS.NEW,
      order_number,
      order_total: total,
      total_amount: total,
      platform_commission: platformCommission,
      platform_fee: platformCommission,
      payment_status: paymentStatus,
      district: district || null,
      service_location: location || null,
      drop_address: location || district || "موقع الخدمة",
      service_qty: normalizeQty(raw.qty ?? raw.service_qty ?? 1),
      gas_mode: raw.gas_mode || null,
      gas_liters: raw.gas_liters != null ? Number(raw.gas_liters) : null,
      scheduled_at: raw.scheduled_at || null,
      pickup_address: district || "خدمة منزلية",
      drop_address: location || district || "موقع الخدمة",
      notes: String(raw.notes || "").trim() || null,
      data: {
        order_type: orderType,
        service_type: serviceType,
        unified: true,
        ...(raw.data && typeof raw.data === "object" ? raw.data : {}),
      },
    };

    const ins = await insertOrdersResilient(sb, row);
    orderData = ins.data;
    insertErr = ins.error;
    if (!insertErr) break;
    const msg = String(insertErr.message || insertErr.details || "");
    if (!/duplicate key|unique constraint/i.test(msg) || attempt === 4) break;
  }

  if (insertErr) {
    return { ok: false, status: 400, message: insertErr.message || String(insertErr) };
  }

  try {
    await notifyProvidersForBooking(sb, orderData);
  } catch (waErr) {
    logger.error({ err: waErr.message || String(waErr), orderId: orderData.id }, "[serviceOrderCreate] notify");
  }

  return { ok: true, order: orderData };
}

module.exports = {
  SERVICE_ORDER_TYPES,
  isServiceOrderType,
  resolveOrderType,
  createServiceOrder,
};
