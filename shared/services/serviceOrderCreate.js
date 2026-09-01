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
const { computeGasPlatformCommission, computeGasTotal } = require("../utils/gasDeliveryPricing");
const { isHomeServiceType, computeHomeServiceTotal } = require("../utils/homeServicePricing");
const { validateCarPolishingOrder, carPolishingServiceTitle } = require("../utils/carPolishingPricing");
const { CP_STATUS } = require("../utils/carPolishingWorkflow");
const {
  isServicePhaseOrder,
  mergeServicePhaseData,
  SP_STATUS,
  normalizeServicePhotos,
  normalizeScheduleMode,
} = require("../utils/servicePhaseWorkflow");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { notifyProvidersForBooking } = require("./serviceBookingNotify");
const { notifyCustomer } = require("./notificationEvents");
const { notifyInternalDeliveryOrder } = require("./internalDeliveryNotify");
const { sendCustomerOrderPaidWhatsApp } = require("../messages/deliveryCustomerWhatsApp");
const { logger } = require("../utils/logger");
const { deferServiceProviderDispatch } = require("../utils/serviceOrderPaymentHold");

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
  "car_polishing",
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

  let total = normalizeMoney(raw.total_amount ?? raw.total ?? raw.price);
  const orderType = resolveOrderType(serviceType);
  const payloadData = raw.data && typeof raw.data === "object" ? { ...raw.data } : {};
  const scheduledAt =
    raw.scheduled_at ||
    payloadData.scheduled_at ||
    payloadData.execution_time ||
    null;

  if (isHomeServiceType(serviceType) && serviceType !== "car_polishing") {
    total = computeHomeServiceTotal(serviceType);
  }
  if (serviceType === "gas_delivery") {
    total = computeGasTotal(
      raw.gas_mode ?? payloadData.gas_mode,
      raw.qty ?? raw.service_qty ?? payloadData.qty ?? 1,
      raw.gas_liters ?? payloadData.gas_liters
    );
  }

  if (serviceType === "car_polishing") {
    const cp = validateCarPolishingOrder({ ...raw, data: payloadData });
    if (!cp.ok) return { ok: false, status: 400, message: cp.message || "invalid car_polishing order" };
    if (total > 0 && Math.abs(total - cp.total) > 0.02) {
      return { ok: false, status: 400, message: "car_polishing price mismatch" };
    }
    total = cp.total;
    if (cp.breakdown) {
      payloadData.pricing_breakdown = cp.breakdown;
      payloadData.platform_commission = cp.breakdown.platform_commission;
      payloadData.vat_amount = cp.breakdown.vat_amount;
      payloadData.total_with_vat = cp.breakdown.total_with_vat;
      payloadData.provider_net = cp.breakdown.provider_net;
      payloadData.vehicle_type = cp.input.vehicle_type;
      payloadData.addon_engine_wash = cp.input.addon_engine_wash;
      payloadData.addon_wheels = cp.input.addon_wheels;
      payloadData.addon_exterior = cp.input.addon_exterior;
      payloadData.vehicle_photos = cp.input.vehicle_photos || [];
      payloadData.schedule_mode = cp.input.schedule_mode || "immediate";
      payloadData.scheduled_at = cp.input.scheduled_at || scheduledAt || null;
      payloadData.cp_status = CP_STATUS.NEW;
    }
  }

  const phaseProbe = {
    service_type: serviceType,
    gas_mode: raw.gas_mode || payloadData.gas_mode,
    data: payloadData,
  };
  if (isServicePhaseOrder(phaseProbe)) {
    payloadData.service_subtype = String(payloadData.service_subtype || raw.service_subtype || "").trim() || null;
    payloadData.service_photos = normalizeServicePhotos(
      payloadData.service_photos || raw.service_photos || payloadData.photos || []
    );
    payloadData.schedule_mode = normalizeScheduleMode(payloadData.schedule_mode || raw.schedule_mode);
    payloadData.scheduled_at = payloadData.scheduled_at || scheduledAt || null;
    payloadData.sp_status = SP_STATUS.NEW;
  }

  const orderNotes = String(
    raw.notes || payloadData.order_notes || payloadData.customer_notes || ""
  ).trim();

  if (isServicePhaseOrder(phaseProbe) && orderNotes) {
    payloadData.order_notes = orderNotes;
    payloadData.customer_notes = orderNotes;
  }

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

  const heldForPayment = deferServiceProviderDispatch(serviceType, paymentStatus, payloadData);
  const initialDeliveryStatus = heldForPayment ? DELIVERY_STATUS.DRAFT : DELIVERY_STATUS.NEW;

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
      service_name: String(
        raw.service_name ||
          raw.title ||
          payloadData.shipment_name ||
          (serviceType === "car_polishing" && payloadData.vehicle_type
            ? carPolishingServiceTitle(payloadData.vehicle_type)
            : serviceType)
      ).trim(),
      delivery_status: initialDeliveryStatus,
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
      scheduled_at: scheduledAt,
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
      notes: orderNotes || (noteLines.length ? noteLines.join("\n") : null),
      data: {
        order_type: orderType,
        service_type: serviceType,
        unified: true,
        provider_net: Math.max(0, Math.round((total - platformCommission) * 100) / 100),
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
    } else if (!heldForPayment) {
      await notifyProvidersForBooking(sb, orderData);
    }
  } catch (waErr) {
    logger.error({ err: waErr.message || String(waErr), orderId: orderData.id }, "[serviceOrderCreate] notify");
  }

  if (orderData.customer_id) {
    try {
      await notifyCustomer(
        sb,
        orderData.customer_id,
        "customer.order.received",
        "تم استلام طلبك",
        heldForPayment
          ? `تم حفظ طلب ${orderData.service_name || "الخدمة"} رقم ${orderData.order_number || orderData.id} — أكمل الدفع لإرساله لمزوّدي الخدمة.`
          : `تم استلام طلب ${orderData.service_name || "الخدمة"} رقم ${orderData.order_number || orderData.id} — بانتظار قبول مزود.`,
        orderData
      );
    } catch (notifyErr) {
      logger.warn({ err: notifyErr.message || String(notifyErr), orderId: orderData.id }, "[serviceOrderCreate] customer received");
    }
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
