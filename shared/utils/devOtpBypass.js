/**
 * تجاوز OTP للتطوير — مفعّل افتراضياً؛ عطّله في الإنتاج: ALLOW_DEV_OTP=false
 * Env: ALLOW_DEV_OTP=true | ERVENOW_DEV_OTP_CODE=1977 (افتراضي 1977)
 */

function allowDevOtpBypass() {
  const flag = String(process.env.ALLOW_DEV_OTP || "")
    .trim()
    .toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") return false;
  return true;
}

function getDevOtpBypassCode() {
  const c = String(process.env.ERVENOW_DEV_OTP_CODE || "1977").trim();
  return c || "1977";
}

function isDevOtpBypassCode(code) {
  if (!allowDevOtpBypass()) return false;
  return String(code || "").trim() === getDevOtpBypassCode();
}

module.exports = {
  allowDevOtpBypass,
  getDevOtpBypassCode,
  isDevOtpBypassCode,
};
