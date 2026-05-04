/**
 * طبقة تشغيل واتساب (ERVENOW) — تمركز الإرسال والقوالب مع عدم تعارض نصوص العميل العربية السابقة.
 */

const { sendWhatsApp } = require("../utils/whatsapp");
const { normalizePhone } = require("../utils/phone");
const {
  buildCustomerMessageOrderAccepted,
  buildCustomerMessageOrderPickedUp,
  buildCustomerMessageDriverArrived,
  buildPublicTrackUrl,
  sendDeliveryCustomerWhatsApp,
} = require("../messages/deliveryCustomerWhatsApp");

function publicBaseUrl() {
  return String(process.env.ERVENOW_PUBLIC_URL || "").trim().replace(/\/$/, "");
}

function maskPhoneForLog(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 6) return "***";
  return d.slice(0, 4) + "***" + d.slice(-3);
}

function logWaSent(phone, type) {
  console.log("WHATSAPP SENT:", maskPhoneForLog(phone), type);
}

async function sendTyped(to, message, type) {
  const ok = await sendWhatsApp({ to, message: String(message || "") });
  if (ok) logWaSent(to, type);
  return ok;
}

/** رابط استلام/لوحة المندوب (بدون جلسة JWT — يفتح الواجهة للقبول من المتصفح) */
function buildDriverOrderDeepLink(orderId) {
  const base = publicBaseUrl();
  const id = encodeURIComponent(String(orderId || "").trim());
  if (!id) return "";
  if (base) return `${base}/driver-dashboard.html?order=${id}`;
  return `https://ervenow.com/driver/order/${id}`;
}

function buildPickupMapsUrl(order) {
  const lat = Number(order?.pickup_lat);
  const lng = Number(order?.pickup_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `https://maps.google.com/?q=${lat},${lng}`;
}

/**
 * 🚚 طلب جديد للمندوب (قالب احترافي — يُستدعى من إشعار المناديب)
 */
async function sendNewOrderToDriver(driver, order) {
  const phone = driver?.phone || driver?.Phone;
  if (!phone || !order) return false;
  const orderNumber =
    (order.order_number && String(order.order_number).trim()) || String(order.id || "").slice(0, 8) + "…";
  const maps = buildPickupMapsUrl(order) || "—";
  const acceptUrl = buildDriverOrderDeepLink(order.id) || "—";
  const kmRaw = Number(order?.distance_km);
  const kmStr = Number.isFinite(kmRaw) && kmRaw > 0 ? `${kmRaw.toFixed(1)} كم` : "—";
  const fee = Number(order?.delivery_fee) || Number(order?.driver_earning) || 0;
  const body =
    `🚚 طلب جديد\n\n` +
    `رقم الطلب: ${orderNumber}\n` +
    `المسافة: ${kmStr} | التوصيل: ${fee} ر.س\n\n` +
    `الموقع:\n${maps}\n\n` +
    `اضغط للاستلام:\n${acceptUrl}`;
  return sendTyped(phone, body, "new_order_driver");
}

/**
 * قبول الطلب للعميل — نفس النص المتفق عليه سابقاً (منصة + رقم + مندوب + تتبع + تم قبول الطلب)
 */
async function sendOrderAcceptedToCustomer(order, driverPhone) {
  if (!order?.customer_phone) return false;
  const body = buildCustomerMessageOrderAccepted(order, driverPhone);
  const ok = await sendDeliveryCustomerWhatsApp(order.customer_phone, body, null);
  if (ok) logWaSent(order.customer_phone, "order_accepted_customer");
  return ok;
}

/**
 * المندوب في الطريق — نفس جملة «تم استلام الطلب والمندوب متوجه إليكم»
 */
async function sendCustomerDeliveringNotice(order) {
  if (!order?.customer_phone) return false;
  const body = buildCustomerMessageOrderPickedUp();
  const ok = await sendDeliveryCustomerWhatsApp(order.customer_phone, body, null);
  if (ok) logWaSent(order.customer_phone, "customer_delivering");
  return ok;
}

/**
 * وصول المندوب — يدمج «المندوب وصل» مع سطر التحية من المهمة الجديدة
 */
async function sendDriverArrived(order) {
  if (!order?.customer_phone) return false;
  const body = `${buildCustomerMessageDriverArrived()}\n\nنأمل تجربة سعيدة 🌟`;
  const ok = await sendDeliveryCustomerWhatsApp(order.customer_phone, body, null);
  if (ok) logWaSent(order.customer_phone, "driver_arrived_customer");
  return ok;
}

/**
 * رابط تتبع فقط (token = order.id إن لم يُمرَّر رمز منفصل لاحقاً)
 */
async function sendTrackingLink(order, token) {
  if (!order?.customer_phone) return false;
  const id = token != null && String(token).trim() !== "" ? String(token).trim() : String(order.id || "").trim();
  if (!id) return false;
  const base = publicBaseUrl();
  const path = `/track?id=${encodeURIComponent(id)}`;
  const url = base ? `${base}${path}` : path;
  const body =
    `📦 تم استلام طلبك\n\n` +
    `🚚 المندوب في الطريق إليك\n\n` +
    `📍 تتبع مباشر:\n${url}`;
  return sendTyped(order.customer_phone, body, "tracking_link_customer");
}

function buildSupportMenuBody() {
  return (
    `🤖 مرحباً بك في ERVENOW\n\n` +
    `1- طلباتي\n` +
    `2- تتبع\n` +
    `3- دعم`
  );
}

async function sendSupportMenu(user) {
  const phone = user?.phone || user?.Phone || user;
  if (!phone) return false;
  return sendTyped(phone, buildSupportMenuBody(), "support_menu");
}

async function sendOTP(phone, code, opts = {}) {
  const c = String(code ?? "").trim();
  if (!c || c.length > 12) return false;
  const body =
    opts.message ||
    `🔐 رمز التحقق ERVENOW:\n\n${c}\n\nلا تشاركه مع أحد.`;
  return sendTyped(phone, body, opts.type || "otp");
}

module.exports = {
  publicBaseUrl,
  buildDriverOrderDeepLink,
  buildPickupMapsUrl,
  logWaSent,
  buildSupportMenuBody,
  sendOTP,
  sendNewOrderToDriver,
  sendOrderAcceptedToCustomer,
  sendCustomerDeliveringNotice,
  sendDriverArrived,
  sendTrackingLink,
  sendSupportMenu,
  normalizePhone,
};
