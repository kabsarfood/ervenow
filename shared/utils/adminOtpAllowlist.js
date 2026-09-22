/**
 * قائمة أرقام OTP لوحة الإدارة — نفس مصادر apps/admin (full / limited1 / limited2).
 * تُقرأ من البيئة في كل استدعاء حتى تبقى الاختبارات قابلة للضبط.
 */

const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("./phone");

function toStoragePhoneDigits(input) {
  const e = toE164(input);
  return e ? toStorageDigits(e) : String(input || "").replace(/\D/g, "");
}

function adminOtpDigitsFromEnvList(rawList) {
  const out = [];
  for (const part of String(rawList || "").split(",")) {
    const raw = String(part || "").trim();
    if (!raw) continue;
    const e = toE164(raw);
    if (!e || !isErvnowSaudiMobileE164(e)) continue;
    out.push(toStorageDigits(e));
  }
  return out;
}

function getAllowedAdminPhoneDigitsSet() {
  const login = toStoragePhoneDigits(process.env.ERVENOW_ADMIN_LOGIN_PHONE || "0505745650");
  return new Set(
    [
      login,
      ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_FULL_PHONES),
      ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_LIMITED1_PHONES),
      ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_LIMITED2_PHONES),
    ].filter(Boolean)
  );
}

function isAllowedAdminPhoneDigits(phoneDigits) {
  const canonical = toStoragePhoneDigits(phoneDigits);
  const raw = String(phoneDigits || "").replace(/\D/g, "");
  const set = getAllowedAdminPhoneDigitsSet();
  if (canonical && set.has(canonical)) return true;
  if (raw && set.has(raw)) return true;
  return false;
}

module.exports = {
  toStoragePhoneDigits,
  getAllowedAdminPhoneDigitsSet,
  isAllowedAdminPhoneDigits,
};
