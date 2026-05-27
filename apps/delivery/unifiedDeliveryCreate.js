/**
 * إنشاء طلبات التوصيل الموحد — POST /api/delivery/create
 * يبني جسمًا متوافقًا مع createDeliveryOrderFromBody مع force_delivery_fee و data.
 */
const { computeUnifiedDeliveryFee } = require("./unifiedDeliveryPricing");
const { createDeliveryOrderFromBody, getRoadDistanceKm } = require("./service");
const { createGasDelivery } = require("./gasDeliveryCreate");

const CAR_VEHICLE = new Set(["sedan", "van", "suv"]);
const CAR_COND = new Set(["working", "damaged", "broken", "appraisal"]);
const TRANSFER = new Set(["internal", "external"]);

function str(v) {
  return String(v == null ? "" : v).trim();
}

function validateCarTransportPayload(p) {
  const vehicle_category = str(p.vehicle_category).toLowerCase();
  const vehicle_condition = str(p.vehicle_condition).toLowerCase();
  const transfer_mode = str(p.transfer_mode || "internal").toLowerCase();
  if (!CAR_VEHICLE.has(vehicle_category)) return "نوع المركبة غير صالح";
  if (!CAR_COND.has(vehicle_condition)) return "حالة المركبة غير صالحة";
  if (!TRANSFER.has(transfer_mode)) return "نوع النقل غير صالح";
  const pickup_lat = Number(p.pickup_lat);
  const pickup_lng = Number(p.pickup_lng);
  const drop_lat = Number(p.drop_lat);
  const drop_lng = Number(p.drop_lng);
  if (![pickup_lat, pickup_lng, drop_lat, drop_lng].every((x) => Number.isFinite(x))) {
    return "يرجى تحديد موقع الاستلام والتسليم على الخريطة";
  }
  if (transfer_mode === "external") {
    if (!str(p.from_city) || !str(p.to_city)) return "يرجى اختيار مدينة الانطلاق والوصول";
  }
  return null;
}

function buildCarTransportNotes(p, feeInfo, serviceLabel) {
  const label = str(serviceLabel) || "car_transport";
  const lines = [
    `[ERVENOW unified] ${label}`,
    `المركبة: ${p.vehicle_category} — الحالة: ${p.vehicle_condition}`,
    `النقل: ${feeInfo.mode === "external" ? "خارجي" : "داخلي"}`,
    `المسافة (طريق تقريبي): ${Number(feeInfo.distance_km || 0).toFixed(2)} كم`,
    `أجرة النقل: ${Number(feeInfo.delivery_fee || 0).toFixed(2)} ر.س`,
  ];
  if (str(p.pickup_district_label)) lines.push(`منطقة الاستلام: ${p.pickup_district_label}`);
  if (str(p.drop_district_label)) lines.push(`منطقة التسليم: ${p.drop_district_label}`);
  if (str(p.from_city)) lines.push(`من: ${p.from_city}`);
  if (str(p.to_city)) lines.push(`إلى: ${p.to_city}`);
  if (str(p.notes_extra)) lines.push(`ملاحظات: ${p.notes_extra}`);
  return lines.join("\n");
}

async function createCarTransport(sb, appUser, payload, topBody, opts) {
  const err = validateCarTransportPayload(payload);
  if (err) return { data: null, error: new Error(err) };

  const pickup_lat = Number(payload.pickup_lat);
  const pickup_lng = Number(payload.pickup_lng);
  const drop_lat = Number(payload.drop_lat);
  const drop_lng = Number(payload.drop_lng);

  let distanceKm = 0;
  try {
    distanceKm = await getRoadDistanceKm(pickup_lat, pickup_lng, drop_lat, drop_lng);
  } catch (_e) {
    distanceKm = 0;
  }
  if (!(distanceKm > 0)) {
    return { data: null, error: new Error("تعذر حساب المسافة بين النقطتين") };
  }
  if (distanceKm < 0.02) {
    return { data: null, error: new Error("نقطتا الاستلام والتسليم متطابقتان تقريباً — حرّك الدبوس") };
  }

  const transfer_mode = str(payload.transfer_mode || "internal").toLowerCase();
  const feeResult = computeUnifiedDeliveryFee("car_transport", {
    transfer_mode,
    distance_km: distanceKm,
  });
  if (!feeResult.ok) {
    return { data: null, error: new Error(feeResult.message || "تسعير غير صالح") };
  }

  const pickup_address =
    str(payload.pickup_address) ||
    [str(payload.pickup_district_label), str(payload.from_city)].filter(Boolean).join(" — ") ||
    "موقع الاستلام";
  const drop_address =
    str(payload.drop_address) ||
    [str(payload.drop_district_label), str(payload.to_city)].filter(Boolean).join(" — ") ||
    "موقع التسليم";

  const requestedSt = str(topBody.service_type).toLowerCase();
  const serviceTypeStored = requestedSt === "pickup_truck" ? "pickup_truck" : "vehicle_transfer";
  const notes = buildCarTransportNotes(payload, feeResult, serviceTypeStored);

  const fromCity = transfer_mode === "external" ? str(payload.from_city) : "";
  const toCity = transfer_mode === "external" ? str(payload.to_city) : "";

  const orderData = {
    unified: true,
    service_type: serviceTypeStored,
    legacy_service_type: "vehicle_transfer",
    from_location: {
      lat: pickup_lat,
      lng: pickup_lng,
      address: pickup_address,
      district: str(payload.pickup_district_label) || null,
      city: fromCity || null,
    },
    to_location: {
      lat: drop_lat,
      lng: drop_lng,
      address: drop_address,
      district: str(payload.drop_district_label) || null,
      city: toCity || null,
    },
    distance_km: Math.round(Number(feeResult.distance_km || distanceKm) * 1000) / 1000,
    price: Math.round(Number(feeResult.delivery_fee || 0) * 100) / 100,
    car: {
      vehicle_category: str(payload.vehicle_category).toLowerCase(),
      vehicle_condition: str(payload.vehicle_condition).toLowerCase(),
      transfer_mode,
      pickup_district_label: str(payload.pickup_district_label),
      drop_district_label: str(payload.drop_district_label),
      from_city: str(payload.from_city),
      to_city: str(payload.to_city),
      notes_extra: str(payload.notes_extra),
    },
  };

  const compat = {
    pickup_lat,
    pickup_lng,
    drop_lat,
    drop_lng,
    pickup_address,
    drop_address,
    notes,
    order_total: 0,
    customer_phone: str(topBody.customer_phone) || str(appUser.phone) || "",
    force_delivery_fee: true,
    delivery_fee: feeResult.delivery_fee,
    distance_km_override: distanceKm,
    vehicle_type: str(payload.vehicle_category).toLowerCase() === "van" ? "van" : "car",
    series_source: str(topBody.series_source) || "ervenow-unified",
    external_order_id: topBody.external_order_id,
    idempotency_key: topBody.idempotency_key,
    data: orderData,
    order_type: "service",
    service_type: serviceTypeStored,
  };

  return createDeliveryOrderFromBody(sb, appUser, compat, opts);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} appUser
 * @param {object} rawBody { service_type, payload, ... }
 * @param {object} [opts] createDeliveryOrderFromBody options
 */
const { canPlaceOrders, driverOrderPlacementError } = require("../../shared/utils/platformAccessPolicy");

async function createUnifiedDeliveryOrder(sb, appUser, rawBody, opts) {
  if (!canPlaceOrders(appUser && appUser.role)) {
    return { data: null, error: new Error(driverOrderPlacementError()) };
  }
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const service_type = str(body.service_type).toLowerCase();
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  if (service_type === "car_transport" || service_type === "pickup_truck") {
    return createCarTransport(sb, appUser, payload, body, opts);
  }
  if (service_type === "furniture") {
    return { data: null, error: new Error("نقل الأثاث قيد التفعيل ضمن النظام الموحد") };
  }
  if (service_type === "gas_delivery") {
    return createGasDelivery(sb, appUser, body);
  }
  if (service_type === "local_delivery") {
    return { data: null, error: new Error("التوصيل الداخلي قيد التفعيل") };
  }
  return { data: null, error: new Error("service_type غير مدعوم") };
}

module.exports = {
  createUnifiedDeliveryOrder,
  validateCarTransportPayload,
  createGasDelivery,
};
