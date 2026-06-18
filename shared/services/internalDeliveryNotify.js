const { sendWhatsApp } = require("../utils/whatsapp");
const { commissionPercentLabel } = require("../utils/serviceCommission");
const { buildPublicTrackUrl } = require("../messages/deliveryCustomerWhatsApp");
const { notifyDriversInAppByPhones } = require("./notificationEvents");
const {
  bookingVehicleCategory,
  vehicleCategoryLabel,
  driverCarTypeForCategory,
} = require("../utils/internalDeliveryVehicle");

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

function buildInternalDeliveryProviderMessage(booking) {
  const d = orderData(booking);
  const total = Number(booking.total_amount || 0);
  const comm = Number(booking.platform_commission || 0);
  const net = Math.max(0, Math.round((total - comm) * 100) / 100);
  const pct = commissionPercentLabel(booking.service_type);
  const pay = booking.payment_status === "paid" ? "مدفوع ✅" : "الدفع عند التوصيل 💵";
  const orderNo = booking.order_number || booking.service_order_number || booking.id || "—";
  const trackUrl = buildPublicTrackUrl(booking.id) || `${publicBase()}/track?id=${encodeURIComponent(String(booking.id || ""))}`;
  const veh = vehicleCategoryLabel(bookingVehicleCategory(booking));

  return (
    "مرحباً من منصة ERVENOW 👋\n" +
    "طلب توصيل داخلي جديد (للمندوب):\n\n" +
    `📋 رقم الطلب: ${orderNo}\n` +
    `📦 اسم الشحنة: ${d.shipment_name || booking.service_name || "توصيل داخلي"}\n` +
    `📝 التفاصيل: ${d.shipment_details || d.notes_extra || booking.notes || "—"}\n` +
    `🚗 المركبة المطلوبة: ${veh}\n` +
    `${mapsLine("📍 من (استلام)", d.pickup_maps_url || d.from, d.pickup_lat, d.pickup_lng)}\n` +
    `${mapsLine("📍 إلى (تسليم)", d.drop_maps_url || d.to, d.drop_lat, d.drop_lng)}\n` +
    `📞 جوال طالب الخدمة: ${booking.customer_phone || "—"}\n` +
    `📞 جوال المرسل إليه: ${d.recipient_phone || "—"}\n` +
    `💰 المبلغ: ${total.toFixed(2)} ريال\n` +
    `💳 الدفع: ${pay}\n` +
    `عمولة المنصة (${pct}): ${comm.toFixed(2)} ريال\n` +
    `صافيك بعد الإتمام: ${net.toFixed(2)} ريال\n\n` +
    `🔗 قبول الطلب: ${publicBase()}/driver\n` +
    `🔗 تتبع العميل: ${trackUrl}\n\n` +
    "بعد إتمام المهمة من تطبيق المندوب تُسجَّل العمولة (7%) في ذمتك."
  );
}

function buildInternalDeliveryCustomerMessage(booking) {
  const d = orderData(booking);
  const orderNo = booking.order_number || booking.id || "—";
  const trackUrl = buildPublicTrackUrl(booking.id) || `${publicBase()}/track?id=${encodeURIComponent(String(booking.id || ""))}`;
  return (
    "مرحباً من منصة ERVENOW 👋\n\n" +
    `تم استلام طلب التوصيل الداخلي.\n` +
    `📋 رقم الطلب: ${orderNo}\n` +
    `📦 الشحنة: ${d.shipment_name || booking.service_name || "توصيل داخلي"}\n\n` +
    `تابع طلبك برقم الطلب أو من الخريطة:\n${trackUrl}`
  );
}

async function getInternalDeliveryNotifyPhones(sb, booking) {
  if (!sb || !booking) return [];
  const cat = bookingVehicleCategory(booking);
  const driverType = driverCarTypeForCategory(cat);
  const phones = new Set();

  let q = sb
    .from("drivers")
    .select("phone")
    .eq("status", "approved")
    .eq("active", true);
  if (driverType) q = q.eq("car_type", driverType);
  const { data: drivers, error: dErr } = await q;
  if (!dErr && Array.isArray(drivers)) {
    for (const d of drivers) {
      const p = String(d.phone || "").trim();
      if (p.length >= 10) phones.add(p);
    }
  }

  return [...phones];
}

async function sendInternalDeliveryProviderWhatsApp(phones, booking) {
  if (!Array.isArray(phones) || !phones.length || !booking) return;
  const message = buildInternalDeliveryProviderMessage(booking);
  for (const phone of phones) {
    try {
      await sendWhatsApp({ to: phone, message });
    } catch (e) {
      console.error("[internalDeliveryNotify] provider WA:", e && (e.message || e));
    }
  }
}

async function sendInternalDeliveryCustomerWhatsApp(booking) {
  const phone = String(booking?.customer_phone || "").trim();
  if (!phone || phone.length < 10 || !booking) return;
  try {
    await sendWhatsApp({ to: phone, message: buildInternalDeliveryCustomerMessage(booking) });
  } catch (e) {
    console.error("[internalDeliveryNotify] customer WA:", e && (e.message || e));
  }
}

async function notifyInternalDeliveryOrder(sb, booking) {
  const phones = await getInternalDeliveryNotifyPhones(sb, booking);
  await sendInternalDeliveryProviderWhatsApp(phones, booking);
  try {
    await notifyDriversInAppByPhones(sb, booking, phones);
  } catch (e) {
    console.error("[internalDeliveryNotify] driver in-app:", e && (e.message || e));
  }
}

module.exports = {
  buildInternalDeliveryProviderMessage,
  buildInternalDeliveryCustomerMessage,
  getInternalDeliveryNotifyPhones,
  notifyInternalDeliveryOrder,
  sendInternalDeliveryCustomerWhatsApp,
};
