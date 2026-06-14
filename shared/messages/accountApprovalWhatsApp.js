/**
 * رسالة واتساب بعد موافقة الإدارة على تسجيل الحساب (جميع الأدوار).
 */

function safeName(name) {
  const n = String(name || "").trim();
  if (!n || n.length > 80) return "";
  return n;
}

/** بعد اعتماد الحساب من لوحة الإدارة */
function accountApprovedBody(displayName, options) {
  const who = safeName(displayName);
  const greeting = who ? `${who}\n\n` : "";
  const loginUrl =
    options && options.role === "service"
      ? "\n\nبعد الموافقة سجّل الدخول من:\n/service-provider-login"
      : options && options.role === "driver"
        ? "\n\nبعد الموافقة سجّل الدخول من:\n/driver-login"
        : "";
  return (
    `ERVENOW\n\n` +
    `${greeting}أهلاً بكم في ERVENOW\n` +
    `تم الموافقة ✅\n` +
    `من الآن أنتم شركاء النجاح.` +
    loginUrl
  );
}

module.exports = {
  accountApprovedBody,
};
