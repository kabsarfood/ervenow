/**
 * حالة Twilio للتشغيل — بدون أسرار.
 */

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function waFromRaw() {
  return String(process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM || "").trim();
}

function isTwilioSandboxSender(fromDigits) {
  const d = String(fromDigits || "");
  return d === "14155238886" || (d.startsWith("1415") && d.endsWith("8886"));
}

function twilioUserMessage(err) {
  const code = Number(err && (err.code || err.status));
  if (code === 63015) {
    return "رقم المستلم غير مسموح في قناة واتساب الحالية (Sandbox أو قائمة السماح). استخدم رقم إنتاج أو أضف المستلم.";
  }
  if (code === 63038) {
    return "تم تجاوز حد رسائل واتساب اليومي في Twilio.";
  }
  if (code === 63016 || code === 21608) {
    return "رقم الجوال غير مسجّل في Twilio Sandbox.";
  }
  if (code === 21211 || code === 21614) {
    return "رقم المستلم غير صالح لدى Twilio.";
  }
  return null;
}

function getTwilioRuntimeStatus() {
  const sidSet = Boolean(String(process.env.TWILIO_ACCOUNT_SID || "").trim());
  const tokenSet = Boolean(String(process.env.TWILIO_AUTH_TOKEN || "").trim());
  const from = waFromRaw();
  const fromDigits = digitsOnly(from);
  const sandbox = isTwilioSandboxSender(fromDigits);
  const configured = sidSet && tokenSet && fromDigits.length >= 10;
  return {
    configured,
    sandbox,
    webhook_url_set: Boolean(String(process.env.TWILIO_WEBHOOK_URL || "").trim()),
    from_last4: fromDigits ? fromDigits.slice(-4) : null,
    status: !configured ? "missing" : sandbox ? "sandbox" : "configured",
  };
}

module.exports = {
  getTwilioRuntimeStatus,
  twilioUserMessage,
  isTwilioSandboxSender,
};
