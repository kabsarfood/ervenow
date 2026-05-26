/**
 * عرض رقم الجوال بخصوصية — إظهار آخر 4 أرقام فقط في الواجهة.
 */
(function (global) {
  function digitsOnly(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.startsWith("9665") && d.length === 12) return "0" + d.slice(3);
    if (d.startsWith("5") && d.length === 9) return "0" + d;
    return d;
  }

  function maskPhoneForDisplay(phone) {
    var d = digitsOnly(phone);
    if (d.length < 4) return "••••";
    var last4 = d.slice(-4);
    if (d.startsWith("05") && d.length >= 10) {
      return "05••••••" + last4;
    }
    return "••••••" + last4;
  }

  global.ErvenowPhonePrivacy = {
    maskPhoneForDisplay: maskPhoneForDisplay,
    digitsOnly: digitsOnly,
  };
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this
);
