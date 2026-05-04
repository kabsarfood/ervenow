/**
 * رسائل واتساب للعميل — دورة التوصيل (قبول → في الطريق → وصل).
 */

const { sendWhatsApp } = require("../utils/whatsapp");

const MSG_PLATFORM_WELCOME = "منصة ERVENOW-PALTFORM ترحب بكم";

function buildPublicTrackUrl(orderId) {
  const base = String(process.env.ERVENOW_PUBLIC_URL || "").replace(/\/$/, "");
  if (!base || orderId == null || String(orderId).trim() === "") return "";
  return `${base}/track?id=${encodeURIComponent(String(orderId).trim())}`;
}

/** عرض رقم المندوب للعميل (محاولة 05********) */
function formatDriverPhoneLine(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("966")) return "0" + d.slice(3);
  if (d.startsWith("0")) return d;
  if (d.length === 9) return "0" + d;
  return String(phone || "").trim();
}

/** الرسالة 1 — بعد قبول المندوب للطلب */
function buildCustomerMessageOrderAccepted(order, driverPhoneRaw) {
  const orderNo = order?.order_number || String(order?.id || "").trim() || "—";
  const driverNo = formatDriverPhoneLine(driverPhoneRaw) || String(driverPhoneRaw || "").trim() || "—";
  const trackUrl = buildPublicTrackUrl(order?.id);
  const linkLine = trackUrl || "—";
  return (
    `${MSG_PLATFORM_WELCOME}\n\n` +
    `طلب رقم ${orderNo}\n` +
    `المندوب رقم ${driverNo}\n` +
    `رابط التتبع:\n${linkLine}\n\n` +
    `تم قبول الطلب`
  ).trim();
}

/** الرسالة 2 — بعد الانتقال إلى delivering (استلام الطلب والمندوب في الطريق) */
function buildCustomerMessageOrderPickedUp() {
  return "تم استلام الطلب والمندوب متوجه إليكم";
}

/** الرسالة 3 — بعد التسليم (delivered) */
function buildCustomerMessageDriverArrived() {
  return "المندوب وصل";
}

async function sendDeliveryCustomerWhatsApp(to, messageBody, logger) {
  const phone = String(to || "").trim();
  if (!phone || !messageBody) return false;
  try {
    return await sendWhatsApp({ to: phone, message: messageBody });
  } catch (e) {
    const err = e && (e.message || String(e));
    if (logger && typeof logger.error === "function") {
      logger.error({ err }, "[delivery-customer-wa] send");
    } else {
      console.error("[delivery-customer-wa]", err);
    }
    return false;
  }
}

module.exports = {
  buildPublicTrackUrl,
  formatDriverPhoneLine,
  buildCustomerMessageOrderAccepted,
  buildCustomerMessageOrderPickedUp,
  buildCustomerMessageDriverArrived,
  sendDeliveryCustomerWhatsApp,
};
