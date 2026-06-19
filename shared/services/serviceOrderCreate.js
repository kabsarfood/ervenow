/**
 * إنشاء طلب خدمة — orders فقط (order_type = service | gas_delivery).
 */

const { allocateUniqueServiceOrderNumber } = require("../utils/generateOrderNumber");
const { insertOrdersResilient } = require("../utils/idempotency");
const {
  fetchOrderByCustomerIdempotencyKey,
  findRecentSimilarDeliveryOrder,
} = require("../utils/orderDedup");
const { applyPortalTypeToOrderRow } = require("../utils/orderPortalRouting");
const { normalizeOrderFinancialsForInsert } = require("../utils/orderTotals");
const { applyProviderIdToInsertRow } = require("../utils/orderProviderId");
const { computePlatformCommission } = require("../utils/serviceCommission");
const { computeGasPlatformCommission, gasCylinderProviderNet } = require("../utils/gasDeliveryPricing");
const { isHomeServiceType } = require("../utils/homeServicePricing");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { notifyProvidersForBooking } = require("./serviceBookingNotify");
const { notifyInternalDeliveryOrder } = require("./internalDeliveryNotify");
const { sendCustomerOrderPaidWhatsApp } = require("../messages/deliveryCustomerWhatsApp");
const { logger } = require("../utils/logger");
const { GAS_RADIUS_INITIAL_KM } = require("../utils/gasDeliveryRadius");

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
  "car_transport",
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
const { canPlaceOrders, driverOrderPlacementError } = require("../utils/platformAccessPolicy");

async function createServiceOrder(sb, appUser, body) {
  if (!canPlaceOrders(appUser && appUser.role)) {
    return { ok: false, status: 403, message: driverOrderPlacementError() };
  }
  const raw = body && typeof body === "object" ? body : {};
  const serviceType = String(raw.service_type || raw.type || "service").trim().toLowerCase();
  if (!isServiceOrderType(serviceType) && !isHomeServiceType(serviceType)) {
    return { ok: false, status: 400, message: "invalid service_type" };
  }

  const total = normalizeMoney(raw.total_amount ?? raw.total ?? raw.price);
  const orderType = resolveOrderType(serviceType);
  const payloadData = raw.data && typeof raw.data === "object" ? raw.data : {};
  const platformCommission = normalizeMoney(
    raw.platform_commission ??
      (serviceType === "gas_delivery"
        ? computeGasPlatformCommission(
            raw.gas_mode ?? payloadData.gas_mode,
            raw.qty ?? raw.service_qty ?? payloadData.qty ?? 1,
            raw.gas_liters ?? payloadData.gas_liters,
            total
          )
        : computePlatformCommission(total, serviceType))
  );
  const paymentStatus = String(raw.payment_status || "unpaid").toLowerCase() === "paid" ? "paid" : "unpaid";
  const providerId = raw.provider_id || raw.service_provider_id || null;
  const location = String(raw.location || raw.service_location || raw.drop_address || "").trim();
  const district = String(raw.district || "").trim();
  const idempotencyKey =
    raw.idempotency_key != null && String(raw.idempotency_key).trim() !== ""
      ? String(raw.idempotency_key).trim().slice(0, 256)
      : null;

  const pickupLat = Number(payloadData.pickup_lat);
  const pickupLng = Number(payloadData.pickup_lng);
  const dropLat = Number(payloadData.drop_lat);
  const dropLng = Number(payloadData.drop_lng);
  const hasPickup = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);
  const hasDrop = Number.isFinite(dropLat) && Number.isFinite(dropLng);

  if (idempotencyKey) {
    try {
      const existing = await fetchOrderByCustomerIdempotencyKey(sb, appUser.id, idempotencyKey);
      if (existing) return { ok: true, order: existing };
    } catch (idemErr) {
      logger.warn({ err: idemErr.message || String(idemErr) }, "[serviceOrderCreate] idempotency lookup");
    }
  }

  if (hasPickup && hasDrop) {
    try {
      const similar = await findRecentSimilarDeliveryOrder(sb, appUser.id, {
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        drop_lat: dropLat,
        drop_lng: dropLng,
      });
      if (similar) return { ok: true, order: similar };
    } catch (dedupErr) {
      logger.warn({ err: dedupErr.message || String(dedupErr) }, "[serviceOrderCreate] dedup lookup");
    }
  }

  let orderData = null;
  let insertErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const order_number = await allocateUniqueServiceOrderNumber(sb, orderType === "gas_delivery" ? "ES" : "SV");
    const pickupAddress = String(payloadData.from || payloadData.pickup_maps_url || district || "").trim();
    const dropAddress = String(payloadData.to || payloadData.drop_maps_url || location || "").trim();
    const noteLines = [
      payloadData.shipment_name ? `الشحنة: ${payloadData.shipment_name}` : "",
      payloadData.shipment_details || payloadData.notes_extra || "",
      payloadData.recipient_phone ? `المرسل إليه: ${payloadData.recipient_phone}` : "",
    ].filter(Boolean);

    const isInternalDelivery = serviceType === "internal_delivery";
    const goodsBase = isInternalDelivery ? 0 : total;
    const serviceDeliveryFee = isInternalDelivery ? total : null;

    const row = applyProviderIdToInsertRow(
      {
      customer_id: appUser.id,
      customer_phone: String(appUser.phone || raw.customer_phone || payloadData.customer_phone || "").trim(),
      order_type: orderType,
      service_type: serviceType,
      service_name: String(raw.service_name || raw.title || payloadData.shipment_name || serviceType).trim(),
      delivery_status: DELIVERY_STATUS.NEW,
      order_number,
      order_total: goodsBase,
      total_amount: total,
      platform_commission: platformCommission,
      platform_fee: platformCommission,
      payment_status: paymentStatus,
      district: district || null,
      service_location: location || dropAddress || null,
      drop_address: dropAddress || location || district || "موقع الخدمة",
      service_qty: normalizeQty(raw.qty ?? raw.service_qty ?? 1),
      gas_mode: raw.gas_mode || null,
      gas_liters: raw.gas_liters != null ? Number(raw.gas_liters) : null,
      scheduled_at: raw.scheduled_at || null,
      pickup_address: pickupAddress || district || "خدمة منزلية",
      pickup_lat: hasPickup ? pickupLat : null,
      pickup_lng: hasPickup ? pickupLng : null,
      drop_lat: hasDrop ? dropLat : null,
      drop_lng: hasDrop ? dropLng : null,
      distance_km:
        payloadData.distance_km != null && Number.isFinite(Number(payloadData.distance_km))
          ? Math.round(Number(payloadData.distance_km) * 100) / 100
          : null,
      delivery_fee: serviceDeliveryFee,
      idempotency_key: idempotencyKey,
      notes: String(raw.notes || "").trim() || (noteLines.length ? noteLines.join("\n") : null),
      data: {
        order_type: orderType,
        service_type: serviceType,
        unified: true,
        provider_net:
          serviceType === "gas_delivery" &&
          String((raw.gas_mode ?? payloadData.gas_mode) || "cylinder_swap").toLowerCase() !== "central_refill"
            ? gasCylinderProviderNet(raw.qty ?? raw.service_qty ?? payloadData.qty ?? 1, total)
            : Math.max(0, Math.round((total - platformCommission) * 100) / 100),
        ...(serviceType === "gas_delivery" ? { gas_radius_km: GAS_RADIUS_INITIAL_KM } : {}),
        ...payloadData,
      },
    },
      providerId
    );

    const ins = await insertOrdersResilient(
      sb,
      applyPortalTypeToOrderRow(normalizeOrderFinancialsForInsert(row))
    );
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
    if (serviceType === "internal_delivery") {
      await enqueueDeliveryJob("new-order", { orderId: orderData.id });
      await notifyInternalDeliveryOrder(sb, orderData);
    } else {
      await notifyProvidersForBooking(sb, orderData);
    }
  } catch (waErr) {
    logger.error({ err: waErr.message || String(waErr), orderId: orderData.id }, "[serviceOrderCreate] notify");
  }

  if (paymentStatus === "paid") {
    try {
      await sendCustomerOrderPaidWhatsApp(orderData, logger);
    } catch (waErr) {
      logger.error({ err: waErr.message || String(waErr), orderId: orderData.id }, "[serviceOrderCreate] customer paid WA");
    }
  }

  return { ok: true, order: orderData };
}

module.exports = {
  SERVICE_ORDER_TYPES,
  isServiceOrderType,
  resolveOrderType,
  createServiceOrder,
};
