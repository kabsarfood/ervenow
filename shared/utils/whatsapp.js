const twilio = require("twilio");
const { normalizePhone } = require("./phone");

/** آخر خطأ Twilio (لرسائل أوضح في OTP) */
let lastWhatsAppError = null;

function getLastWhatsAppError() {
  return lastWhatsAppError;
}

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function waFrom() {
  let n = String(
    process.env.TWILIO_WHATSAPP_NUMBER ||
      process.env.TWILIO_WHATSAPP_FROM ||
      ""
  ).trim();
  if (!n) return null;
  if (!n.startsWith("whatsapp:")) n = "whatsapp:" + n.replace(/^\+/, "+");
  return n;
}

/**
 * يرسل رسالة واتساب عبر Twilio. يتجاهل الإرسال إن لم تُضبط بيانات Twilio أو الرقم.
 * @param {{ to: string, message: string }} opts
 * @returns {Promise<boolean>} true عند نجاح الإرسال
 */
async function sendWhatsApp({ to, message }) {
  const client = getTwilioClient();
  const from = waFrom();
  const digits = normalizePhone(String(to || "").trim());
  if (!client || !from || !digits || digits.length < 10) {
    console.warn("[sendWhatsApp] تخطّي: Twilio غير مضبوط أو رقم المستلِم غير صالح");
    return false;
  }
  const toWa = "whatsapp:+" + digits;
  const body = String(message || "");
  lastWhatsAppError = null;
  try {
    await client.messages.create({ from, to: toWa, body });
    return true;
  } catch (err) {
    lastWhatsAppError = err;
    const code = err && (err.code || err.status);
    console.error("[sendWhatsApp] Twilio:", code, err.message || err);
    return false;
  }
}

module.exports = { sendWhatsApp, getLastWhatsAppError };
