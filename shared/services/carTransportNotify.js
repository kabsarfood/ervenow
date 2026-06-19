const { sendWhatsApp } = require("../utils/whatsapp");
const { commissionPercentLabel } = require("../utils/serviceCommission");
const { providerAreaMatches, normDistrictText } = require("../utils/serviceProviderTypes");
const { notifyProvidersInAppByPhones } = require("./notificationEvents");

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
  const to = d.to_location && typeof d.to_location === "object" ? d.to_location : {};
  return {
    district: String(
      booking.district ||
        car.pickup_district_label ||
        d.pickup_district_label ||
        from.district ||
        from.city ||
        d.from_city ||
        ""
    ).trim(),
    location: String(
      booking.service_location ||
        booking.pickup_address ||
        d.pickup_maps_url ||
        from.address ||
        booking.location ||
        d.from_city ||
        d.to_city ||
        to.city ||
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
  if (!normDistrictText(providerDistrict)) return true;
  return providerAreaMatches("pickup_truck", providerDistrict, loc.district, loc.location);
}

async function getCarTransportProviderPhones(sb, booking) {
  if (!sb || !booking) return [];
  const { data, error } = await sb
    .from("users")
    .select("phone, service_type, service_district, role")
    .eq("service_type", "pickup_truck")
    .in("role", ["service", "driver"]);
  if (error || !Array.isArray(data)) return [];
  const phones = new Set();
  for (const u of data) {
    if (!providerMatchesCarBooking(u.service_district, booking)) continue;
    const p = String(u.phone || "").trim();
    if (p.length >= 10) phones.add(p);
  }
  return [...phones];
}

function buildCarTransportProviderPanelUrl(booking) {
  const id = String(booking?.id || "").trim();
  const no = String(booking?.order_number || booking?.service_order_number || "").trim();
  const key = id || no;
  if (!key) return `${publicBase()}/services-provider.html`;
  return `${publicBase()}/services-provider.html?order=${encodeURIComponent(key)}&action=reserve`;
}

/** إشعار أولي — ملخص + رابط الحجز (التفاصيل بعد الحجز) */
function buildCarTransportProviderMessage(booking) {
  const loc = carBookingLocation(booking);
  const total = Number(booking.total_amount || booking.delivery_fee || 0);
  const pay = booking.payment_status === "paid" ? "مدفوع ✅" : "بانتظار الدفع 💵";
  const orderNo = booking.order_number || booking.service_order_number || booking.id || "—";
  const panelUrl = buildCarTransportProviderPanelUrl(booking);
  const cityLine = loc.district ? `في ${loc.district}` : "متاح الآن";

  return (
    "مرحباً من منصة ERVENOW 👋\n" +
    `🛻 طلب سطحة جديد ${cityLine}\n\n` +
    `📋 رقم الطلب: ${orderNo}\n` +
    (loc.vehicleCategory ? `🚗 نوع المركبة: ${loc.vehicleCategory}\n` : "") +
    `💰 المبلغ: ${total.toFixed(2)} ريال\n` +
    `💳 الدفع: ${pay}\n\n` +
    "👇 افتح الرابط ثم اضغط «حجز الطلب» (أول من يحجز يأخذ الطلب):\n" +
    `🔗 ${panelUrl}\n\n` +
    "بعد الحجز ستصلك تفاصيل الاستلام والتسليم وأرقام التواصل على واتساب."
  );
}

/** تفاصيل النقل — يُرسل بعد حجز الطلب من اللوحة */
function buildCarTransportReserveDetailsMessage(booking, providerName) {
  const loc = carBookingLocation(booking);
  const total = Number(booking.total_amount || booking.delivery_fee || 0);
  const comm = Number(booking.platform_commission || booking.platform_fee || 0);
  const net = Math.max(0, Math.round((total - comm) * 100) / 100);
  const pct = commissionPercentLabel(booking.service_type);
  const pay = booking.payment_status === "paid" ? "مدفوع ✅" : "بانتظار الدفع 💵";
  const orderNo = booking.order_number || booking.service_order_number || booking.id || "—";
  const panelUrl = buildCarTransportProviderPanelUrl(booking);
  const greet = providerName ? `مرحباً ${providerName}` : "مرحباً";

  return (
    `${greet} — تم حجز طلب السطحة بنجاح ✅\n\n` +
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
    "تواصل مع العميل ونفّذ النقل. بعد الإنهاء اضغط «تم التنفيذ» من لوحتك.\n" +
    `🔗 لوحتك: ${panelUrl.replace("&action=reserve", "")}`
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
  try {
    await notifyProvidersInAppByPhones(sb, booking, phones);
  } catch (e) {
    console.error("[carTransportNotify] provider in-app:", e && (e.message || e));
  }
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
  buildCarTransportProviderPanelUrl,
  buildCarTransportProviderMessage,
  buildCarTransportReserveDetailsMessage,
  notifyCarTransportProviders,
};
