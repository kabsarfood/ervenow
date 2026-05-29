/**
 * قوالب واتساب — تسجيل الدخول / OTP (ERVENOW AUTH)
 */

function buildAuthOtpMessage(code, contextLine) {
  const c = String(code ?? "").trim();
  if (!c) return "";
  const ctx = contextLine ? `${String(contextLine).trim()}\n\n` : "";
  return (
    `🔥 ERVENOW AUTH\n\n` +
    ctx +
    `${c}\n\n` +
    `صلاحية الرمز 5 دقائق · لا تشاركه مع أحد.`
  );
}

module.exports = {
  buildAuthOtpMessage,
};
