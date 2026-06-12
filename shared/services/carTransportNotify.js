const { sendWhatsApp } = require("../utils/whatsapp");
const { commissionPercentLabel } = require("../utils/serviceCommission");
const { buildPublicTrackUrl } = require("../messages/deliveryCustomerWhatsApp");
const { providerAreaMatches, normDistrictText } = require("../utils/serviceProviderTypes");

const CAR_TRANSPORT_TYPES = new Set(["car_transport", "vehicle_transfer", "pickup_truck"]);

function publicBase() {
  return String(process.env.ERVENOW_PUBLIC_URL || "https://ervenow.com").replace(/\/$/, "");
}

function orderData(booking) {
  return booking && booking.data && typeof booking.data === "object" ? booking.data : {};
}

function mapsLine(label, url, lat, lng) {
  if (url) return `${label}: ${url}`;
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `${label}: https://www.google.com/maps?q=${lat},${lng}`;
  }
  return `${label}: —`;
}

function carBookingLocation(booking) {
  const d = orderData(booking);
  const car = d.car && typeof d.car === "object" ? d.car : {};
  const from = d.from_location && typeof d.from_location === "object" ? d.from_location : {};
  return {
    district: String(booking.district || car.pickup_district_label || from.district || "").trim(),
    location: String(
      booking.service_location ||
        booking.pickup_address ||
        d.pickup_maps_url ||
        from.address ||
        booking.location ||
        ""
    ).trim(),
    pickupUrl: String(d.pickup_maps_url || "").trim(),
    dropUrl: String(d.drop_maps_url || "").trim(),
    pickupLat: booking.pickup_lat != null ? booking.pickup_lat : from.lat,
    pickupLng: booking.pickup_lng != null ? booking.pickup_lng : from.lng,
    dropLat: booking.drop_lat != null ? booking.drop_lat : d.to_location?.lat,
    dropLng: booking.drop_lng != null ? booking.drop_lng : d.to_location?.lng,
    plate: String(d.plate_number || car.plate_number || "").trim(),
    senderPhone: String(d.sender_phone || booking.customer_phone || "").trim(),
    recipientPhone: String(d.recipient_phone || "").trim(),
    vehicleCategory: String(car.vehicle_category || d.vehicle_category || "").trim(),
    vehicleCondition: String(car.vehicle_condition || d.vehicle_condition || "").trim(),
    transferMode: String(car.transfer_mode || d.transfer_mode || "").trim(),
  };
}

function providerMatchesCarBooking(providerDistrict, booking) {
  const loc = carBookingLocation(booking);
  const hay = normDistrictText(`${loc.district} ${loc.location}`);
  if (!hay.trim()) return true;
  return providerAreaMatches("pickup_truck", providerDistrict, loc.district, loc.location);
}

async function getCarTransportProviderPhones(sb, booking) {
  if (!sb || !booking) return [];
  const { data, error } = await sb
    .from("users")
    .select("phone, service_type, service_district")
    .eq("role", "service")
    .eq("service_type", "pickup_truck");
  if (error || !Array.isArray(data)) return [];
  const phones = new Set();
  for (const u of data) {
    if (!providerMatchesCarBooking(u.service_district, booking)) continue;
    const p = String(u.phone || "").trim();
    if (p.length >= 10) phones.add(p);
  }
  return [...phones];
}

function buildCarTransportProviderMessage(booking) {
  const loc = carBookingLocation(booking);
  const total = Number(booking.total_amount || booking.delivery_fee || 0);
  const comm = Number(booking.platform_commission || booking.platform_fee || 0);
  const net = Math.max(0, Math.round((total - comm) * 100) / 100);
  const pct = commissionPercentLabel(booking.service_type);
  const pay = booking.payment_status === "paid" ? "مدفوع ✅" : "بانتظار الدفع 💵";
  const orderNo = booking.order_number || booking.service_order_number || booking.id || "—";
  const trackUrl = buildPublicTrackUrl(booking.id) || `${publicBase()}/track?id=${encodeURIComponent(String(booking.id || ""))}`;

  return (
    "مرحباً من منصة ERVENOW 👋\n" +
    "طلب نقل مركبات جديد (سطحة):\n\n" +
    `📋 رقم الطلب: ${orderNo}\n` +
    (loc.plate ? `🚘 اللوحة: ${loc.plate}\n` : "") +
    (loc.vehicleCategory ? `🚗 نوع المركبة: ${loc.vehicleCategory}\n` : "") +
    (loc.vehicleCondition ? `🔧 الحالة: ${loc.vehicleCondition}\n` : "") +
    (loc.transferMode ? `🛣️ النقل: ${loc.transferMode}\n` : "") +
    `${mapsLine("📍 استلام المركبة", loc.pickupUrl, loc.pickupLat, loc.pickupLng)}\n` +
    `${mapsLine("📍 تسليم المركبة", loc.dropUrl, loc.dropLat, loc.dropLng)}\n` +
    `📞 جوال المرسل: ${loc.senderPhone || "—"}\n` +
    `📞 جوال المرسل إليه: ${loc.recipientPhone || "—"}\n` +
    `💰 المبلغ: ${total.toFixed(2)} ريال\n` +
    `💳 الدفع: ${pay}\n` +
    `عمولة المنصة (${pct}): ${comm.toFixed(2)} ريال\n` +
    `صافيك بعد الإتمام: ${net.toFixed(2)} ريال\n\n` +
    `🔗 حجز الطلب: ${publicBase()}/services-provider.html\n` +
    `🔗 تتبع العميل: ${trackUrl}\n\n` +
    "بعد إتمام المهمة من لوحتك تُسجَّل العمولة في ذمتك."
  );
}

async function sendCarTransportProviderWhatsApp(phones, booking) {
  if (!Array.isArray(phones) || !phones.length || !booking) return;
  const message = buildCarTransportProviderMessage(booking);
  for (const phone of phones) {
    try {
      await sendWhatsApp({ to: phone, message });
    } catch (e) {
      console.error("[carTransportNotify] provider WA:", e && (e.message || e));
    }
  }
}

async function notifyCarTransportProviders(sb, booking) {
  const phones = await getCarTransportProviderPhones(sb, booking);
  await sendCarTransportProviderWhatsApp(phones, booking);
}

function isCarTransportBooking(booking) {
  const t = String(booking?.service_type || "").toLowerCase();
  return CAR_TRANSPORT_TYPES.has(t);
}

function providerAreaMatchesCarBooking(providerType, providerDistrict, booking) {
  const t = String(providerType || "").toLowerCase();
  if (t !== "pickup_truck") return true;
  return providerMatchesCarBooking(providerDistrict, booking);
}

module.exports = {
  CAR_TRANSPORT_TYPES,
  isCarTransportBooking,
  carBookingLocation,
  providerAreaMatchesCarBooking,
  getCarTransportProviderPhones,
  notifyCarTransportProviders,
};
