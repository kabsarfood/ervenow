/**
 * إنشاء طلب توصيل غاز — orders عبر delivery flow (order_type = gas_delivery)
 */
const {
  priceCylinderSwap,
  priceCentralRefill,
  gasServiceLabel,
  CENTRAL_LITERS,
  googleMapsUrl,
} = require("../../shared/utils/gasDeliveryPricing");
const { createDeliveryOrderFromBody } = require("./service");
const { sendGasProviderWhatsApp } = require("../../shared/services/gasDeliveryWhatsApp");

function str(v) {
  return String(v == null ? "" : v).trim();
}

function normalizeGasMode(raw) {
  const m = str(raw).toLowerCase();
  if (m === "bulk" || m === "central_refill" || m === "central" || m === "2") return "central_refill";
  if (m === "cylinder" || m === "cylinder_swap" || m === "1") return "cylinder_swap";
  return "cylinder_swap";
}

function parseLatLng(payload, topBody) {
  const lat = Number(payload.lat ?? payload.drop_lat ?? topBody.lat);
  const lng = Number(payload.lng ?? payload.drop_lng ?? topBody.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, location: `${lat.toFixed(6)},${lng.toFixed(6)}` };
  }
  const loc = str(payload.location || topBody.location);
  const parts = loc.split(",").map((x) => Number(x.trim()));
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return { lat: parts[0], lng: parts[1], location: loc };
  }
  return null;
}

function computeGasPrice(mode, cylinders, liters) {
  if (mode === "central_refill") {
    const L = Number(liters);
    if (!CENTRAL_LITERS.includes(L)) return { ok: false, message: "كمية التعبئة غير مدعومة" };
    return { ok: true, price: priceCentralRefill(L), qty: L, liters: L };
  }
  const c = Math.max(1, Math.min(10, Math.floor(Number(cylinders) || 1)));
  return { ok: true, price: priceCylinderSwap(c), qty: c, liters: null };
}

function normalizePaymentMethod(raw) {
  const p = str(raw).toLowerCase();
  if (p === "paid" || p === "pay_now" || p === "online") return { payment_status: "paid", payment_method: "paid" };
  return { payment_status: "unpaid", payment_method: "cash_on_delivery" };
}

/**
 * @returns {{ data: object|null, error: Error|null }}
 */
async function createGasDelivery(sb, appUser, rawBody) {
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const payload = body.payload && typeof body.payload === "object" ? body.payload : body.data || {};
  const dataBlock = payload.data && typeof payload.data === "object" ? payload.data : payload;

  const mode = normalizeGasMode(dataBlock.mode || dataBlock.gas_mode || payload.mode);
  const cylinders = dataBlock.cylinders ?? payload.cylinders ?? dataBlock.qty;
  const liters = dataBlock.liters ?? payload.liters ?? dataBlock.gas_liters;
  const coords = parseLatLng(payload, body);
  if (!coords) {
    return { data: null, error: new Error("يرجى تحديد موقع التوصيل على الخريطة") };
  }

  const priced = computeGasPrice(mode, cylinders, liters);
  if (!priced.ok) return { data: null, error: new Error(priced.message || "تسعير غير صالح") };

  const pay = normalizePaymentMethod(
    dataBlock.payment_method || payload.payment_method || body.payment_method
  );
  const customer_phone =
    str(dataBlock.customer_phone || payload.customer_phone || body.customer_phone) ||
    str(appUser && appUser.phone);

  const mapsUrl = googleMapsUrl(coords.lat, coords.lng);
  const dropAddress = str(body.drop_address || payload.drop_address || coords.location) || coords.location;
  const pickupAddress = str(body.pickup_address || payload.pickup_address || dropAddress) || dropAddress;

  const { data: order, error } = await createDeliveryOrderFromBody(
    sb,
    appUser || { id: null, phone: customer_phone },
    {
      pickup_address: pickupAddress,
      drop_address: dropAddress,
      pickup_lat: coords.lat,
      pickup_lng: coords.lng,
      drop_lat: coords.lat,
      drop_lng: coords.lng,
      order_total: 0,
      force_delivery_fee: true,
      delivery_fee: priced.price,
      customer_phone,
      notes: `[غاز] ${gasServiceLabel(mode)}`,
      order_type: "gas_delivery",
      service_type: "gas_delivery",
      data: {
        service_type: "gas_delivery",
        unified: true,
        gas: true,
        gas_mode: mode,
        mode: mode === "central_refill" ? "bulk" : "cylinder",
        cylinders: mode === "cylinder_swap" ? priced.qty : null,
        liters: priced.liters,
        payment_method: pay.payment_method,
        district: str(dataBlock.district || payload.district || body.district),
      },
    },
    {
      initialDeliveryStatus: "pending",
      payment_status: pay.payment_status,
      order_type: "gas_delivery",
      service_type: "gas_delivery",
    }
  );

  if (error) {
    return { data: null, error };
  }
  if (!order) {
    return { data: null, error: new Error("تعذر إنشاء طلب الغاز") };
  }

  const enriched = {
    ...order,
    location: dropAddress,
    service_order_number: order.order_number,
    _maps_url: mapsUrl,
    _payment_method: pay.payment_method,
  };

  sendGasProviderWhatsApp(sb, enriched).catch((waErr) => {
    console.error("[gasDeliveryCreate] WhatsApp:", waErr && (waErr.message || waErr));
  });

  const orderShape = {
    ...order,
    service_order_number: order.order_number,
    drop_lat: coords.lat,
    drop_lng: coords.lng,
    pickup_lat: coords.lat,
    pickup_lng: coords.lng,
    payment_method: pay.payment_method,
    commission: order.platform_commission,
  };

  return { data: orderShape, error: null };
}

module.exports = { createGasDelivery };
