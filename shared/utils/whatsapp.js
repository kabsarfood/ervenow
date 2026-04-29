const twilio = require("twilio");
const { normalizePhone } = require("./phone");

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function waFrom() {
  let n = String(process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
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
  await client.messages.create({ from, to: toWa, body });
  return true;
}

module.exports = { sendWhatsApp };
