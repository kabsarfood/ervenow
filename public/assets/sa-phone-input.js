/**
 * جوال سعودي — قبول 05xxxxxxxx أو 9665xxxxxxxx (تخزين/عرض محلي 05…)
 */
(function (global) {
  "use strict";

  function digits(v) {
    return String(v || "").replace(/\D/g, "");
  }

  function toLocal05(v) {
    var d = digits(v);
    if (/^9665\d{8}$/.test(d)) return "0" + d.slice(3);
    if (/^05\d{8}$/.test(d)) return d;
    if (/^5\d{8}$/.test(d)) return "0" + d;
    return "";
  }

  function isValid(v) {
    return /^05\d{8}$/.test(toLocal05(v));
  }

  function toE164(v) {
    var local = toLocal05(v);
    return local ? "+966" + local.slice(1) : null;
  }

  function formatField(el) {
    if (!el) return "";
    var d = digits(el.value);
    if (d.startsWith("9665")) {
      el.value = d.length >= 12 ? "0" + d.slice(3, 12) : d.slice(0, 12);
      return el.value;
    }
    if (d.startsWith("5") && d.length === 9) d = "0" + d;
    el.value = d.slice(0, 10);
    return el.value;
  }

  function invalidMessage() {
    return "أدخل رقم سعودي صحيح: 05xxxxxxxx أو 9665xxxxxxxx";
  }

  global.ErvenowSaPhone = {
    digits: digits,
    toLocal05: toLocal05,
    isValid: isValid,
    toE164: toE164,
    formatField: formatField,
    invalidMessage: invalidMessage,
  };
})(typeof window !== "undefined" ? window : global);
