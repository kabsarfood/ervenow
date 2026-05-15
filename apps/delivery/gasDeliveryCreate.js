/**
 * إنشاء طلب توصيل غاز — service_bookings عبر POST /api/delivery/create
 */
const {
  priceCylinderSwap,
  priceCentralRefill,
  gasServiceLabel,
  CENTRAL_LITERS,
  roundMoney,
} = require("../../shared/utils/gasDeliveryPricing");
const { computePlatformCommission } = require("../../shared/utils/serviceCommission");
const { insertServiceBookingResilient } = require("../../shared/utils/idempotency");
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

const { googleMapsUrl } = require("../../shared/utils/gasDeliveryPricing");

async function buildNextServiceOrderNumber(sb) {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const { count, error } = await sb
    .from("service_bookings")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (error) throw error;
  const seq = (count || 0) + 1;
  return `ES-${day}-${String(seq).padStart(3, "0")}`;
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

  const service_order_number = await buildNextServiceOrderNumber(sb);
  const commission = computePlatformCommission(priced.price, "gas_delivery");
  const mapsUrl = googleMapsUrl(coords.lat, coords.lng);

  const insertRow = {
    service_order_number,
    customer_id: appUser ? appUser.id : null,
    customer_phone,
    service_type: "gas_delivery",
    service_name: gasServiceLabel(mode),
    district: str(dataBlock.district || payload.district || body.district),
    location: coords.location,
    qty: priced.qty,
    gas_mode: mode,
    gas_liters: priced.liters,
    total_amount: priced.price,
    payment_status: pay.payment_status,
    platform_commission: commission,
    status: "new",
  };

  const { data: booking, error } = await insertServiceBookingResilient(sb, insertRow);
  if (error) return { data: null, error };

  const enriched = {
    ...booking,
    _maps_url: mapsUrl,
    _payment_method: pay.payment_method,
  };

  sendGasProviderWhatsApp(sb, enriched).catch((waErr) => {
    console.error("[gasDeliveryCreate] WhatsApp:", waErr && (waErr.message || waErr));
  });

  const orderShape = {
    id: booking.id,
    order_number: booking.service_order_number,
    service_order_number: booking.service_order_number,
    service_type: "gas_delivery",
    delivery_status: booking.status,
    status: booking.status,
    order_total: priced.price,
    delivery_fee: priced.price,
    platform_commission: commission,
    commission,
    customer_phone,
    drop_lat: coords.lat,
    drop_lng: coords.lng,
    pickup_lat: coords.lat,
    pickup_lng: coords.lng,
    payment_status: pay.payment_status,
    payment_method: pay.payment_method,
    data: {
      service_type: "gas_delivery",
      unified: true,
      gas: true,
      mode: mode === "central_refill" ? "bulk" : "cylinder",
      cylinders: mode === "cylinder_swap" ? priced.qty : null,
      liters: priced.liters,
      payment_method: pay.payment_method,
      price: priced.price,
      commission,
      maps_url: mapsUrl,
      location: coords.location,
    },
  };

  return { data: orderShape, error: null, booking };
}

module.exports = {
  createGasDelivery,
  normalizeGasMode,
  computeGasPrice,
};
