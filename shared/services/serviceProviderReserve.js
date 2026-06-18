const { sendWhatsApp } = require("../utils/whatsapp");
const { commissionPercentLabel } = require("../utils/serviceCommission");
const { catalogEntry, serviceDisplayName } = require("../utils/homeServicePricing");
const { labelForType } = require("../utils/serviceProviderTypes");
const { isCarTransportBooking, buildCarTransportReserveDetailsMessage } = require("./carTransportNotify");

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

function mapsUrl(coords, fallbackText) {
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  }
  const t = String(fallbackText || "").trim();
  return t || "—";
}

function paymentLabel(booking) {
  if (booking.payment_status === "paid") return "مدفوع (تم الدفع مسبقاً) ✅";
  const entry = catalogEntry(booking.service_type);
  if (entry && entry.payAfterDiagnosis) return "كاش — الدفع بعد تقييم العطل 💵";
  return "كاش — الدفع عند إتمام الخدمة 💵";
}

function buildReserveWelcomeMessage(booking, providerName) {
  if (isCarTransportBooking(booking)) {
    return buildCarTransportReserveDetailsMessage(booking, providerName);
  }
  const coords = parseCoordsFromLocation(booking.service_location || booking.location);
  const maps = mapsUrl(coords, booking.service_location || booking.location || booking.district);
  const svcName = booking.service_name || serviceDisplayName(booking.service_type);
  const pct = commissionPercentLabel(booking.service_type);
  const greet = providerName ? `مرحباً ${providerName}` : "مرحباً";

  return (
    `${greet} من منصة ERVENOW 👋\n` +
    `تم حجز طلب خدمة لك بنجاح:\n\n` +
    `📋 رقم الطلب: ${booking.service_order_number || booking.order_number || booking.id}\n` +
    `🔧 نوع العمل: ${svcName}\n` +
    `🏘 الحي: ${booking.district || "—"}\n` +
    `📍 موقع طالب الخدمة:\n${maps}\n` +
    `📞 جوال العميل: ${booking.customer_phone || "—"}\n` +
    `💰 المبلغ: ${Number(booking.total_amount || 0).toFixed(2)} ريال\n` +
    `💳 طريقة الدفع: ${paymentLabel(booking)}\n` +
    `عمولة المنصة (${pct}): ${Number(booking.platform_commission || 0).toFixed(2)} ريال\n\n` +
    `تواصل مع العميل ونفّذ المهمة. بعد الإنهاء اضغط «تمام المهمة» من لوحتك أو اطلب من العميل تأكيد الإتمام.\n` +
    `🔗 لوحتك: ${publicBase()}/services-provider.html`
  );
}

async function sendReserveWelcomeWhatsApp(booking, providerPhone, providerName) {
  const phone = String(providerPhone || "").trim();
  if (!phone || !booking) return false;
  const message = buildReserveWelcomeMessage(booking, providerName);
  try {
    await sendWhatsApp({ to: phone, message });
    return true;
  } catch (e) {
    console.error("[serviceProviderReserve] WA:", e && (e.message || e));
    return false;
  }
}

function providerDisplayLabel(serviceType, name) {
  const n = String(name || "").trim();
  if (n) return n;
  return labelForType(serviceType);
}

module.exports = {
  buildReserveWelcomeMessage,
  sendReserveWelcomeWhatsApp,
  providerDisplayLabel,
};
