/**
 * تجاوز OTP للتطوير — معطّل افتراضياً.
 * للتفعيل محلياً فقط: ALLOW_DEV_OTP=true في .env (لا تفعّله في الإنتاج).
 * Env: ERVENOW_DEV_OTP_CODE=1977
 */

function allowDevOtpBypass() {
  const flag = String(process.env.ALLOW_DEV_OTP || "")
    .trim()
    .toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function getDevOtpBypassCode() {
  const c = String(process.env.ERVENOW_DEV_OTP_CODE || "1977").trim();
  return c || "1977";
}

function isDevOtpBypassCode(_code) {
  return false;
}

module.exports = {
  allowDevOtpBypass,
  getDevOtpBypassCode,
  isDevOtpBypassCode,
};
