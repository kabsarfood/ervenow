const { sendWhatsApp } = require("../utils/whatsapp");
const { getServiceProviderPhones } = require("./serviceBookingNotify");
const { googleMapsUrl } = require("../utils/gasDeliveryPricing");

function publicBase() {
  return String(process.env.ERVENOW_PUBLIC_URL || "https://ervenow.com").replace(/\/$/, "");
}

function parseCoordsFromLocation(loc) {
  const parts = String(loc || "")
    .split(",")
    .map((x) => Number(x.trim()));
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function gasQuantityLine(booking) {
  const mode = String(booking.gas_mode || "").toLowerCase();
  if (mode === "central_refill" || mode === "bulk") {
    const L = booking.gas_liters || booking.qty;
    return `${L} لتر`;
  }
  return `${booking.qty || 1} أسطوانة`;
}

function gasTypeLabel(booking) {
  const mode = String(booking.gas_mode || "").toLowerCase();
  if (mode === "central_refill" || mode === "bulk") return "تعبئة غاز مركزي";
  return "تبديل أسطوانة غاز";
}

function paymentLabel(booking) {
  if (booking.payment_status === "paid") return "مدفوع";
  return "الدفع عند التوصيل";
}

async function sendGasProviderWhatsApp(sb, booking) {
  if (!booking) return;
  const phones = await getServiceProviderPhones(sb, "gas_delivery");
  if (!phones.length) return;

  const coords = parseCoordsFromLocation(booking.location);
  const maps =
    (coords && googleMapsUrl(coords.lat, coords.lng)) ||
    booking._maps_url ||
    booking.location ||
    "—";
  const base = publicBase();
  const idEnc = encodeURIComponent(String(booking.id));
  const completeUrl = `${base}/api/driver/complete-order/${idEnc}`;
  const orderNo = booking.service_order_number || booking.id;

  const message =
    `🚚 ERVENOW\n\n` +
    `طلب جديد:\n\n` +
    `📦 رقم الطلب: #${orderNo}\n\n` +
    `🪔 نوع الخدمة:\n${gasTypeLabel(booking)}\n\n` +
    `📊 الكمية:\n${gasQuantityLine(booking)}\n\n` +
    `💰 السعر: ${Number(booking.total_amount || 0).toFixed(2)} ريال\n\n` +
    `💳 الحالة:\n${paymentLabel(booking)}\n\n` +
    `📍 الموقع:\n${maps}\n\n` +
    `⬇️ إتمام المهمة:\n${completeUrl}\n\n` +
    `أو من لوحة المزود:\n${base}/services-provider.html`;

  for (const phone of phones) {
    try {
      await sendWhatsApp({ to: phone, message });
    } catch (e) {
      console.error("[gasDeliveryWhatsApp]", e && (e.message || e));
    }
  }
}

module.exports = { sendGasProviderWhatsApp };
