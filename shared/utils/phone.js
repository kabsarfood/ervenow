/**
 * توحيد أرقام الجوال السعودية إلى صيغة E.164 (+9665xxxxxxxx)
 */
function toE164(input) {
  const raw = String(input || "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (raw.includes("+") && d.startsWith("966")) return "+" + d;
  if (d.startsWith("966") && d.length >= 12) return "+" + d;
  if (d.startsWith("05") && d.length >= 10) return "+966" + d.slice(1);
  if (d.startsWith("5") && d.length === 9) return "+966" + d;
  return null;
}

/** تخزين بدون + (966...) */
function toStorageDigits(e164) {
  return String(e164 || "").replace(/\D/g, "");
}

function normalizePhone(input) {
  const e = toE164(input);
  return e ? toStorageDigits(e) : String(input || "").replace(/\D/g, "");
}

/**
 * رقم جوال سعودي يبدأ بـ 05 محلياً (تخزين: 9665xxxxxxxx — 12 رقماً).
 * يُستعمل لتوحيد دخول ERVENOW.
 */
function isErvnowSaudiMobileE164(e164) {
  if (!e164) return false;
  const d = toStorageDigits(e164);
  return /^9665\d{8}$/.test(d);
}

module.exports = { toE164, toStorageDigits, normalizePhone, isErvnowSaudiMobileE164 };
