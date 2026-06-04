/**
 * إضافة خدمة/توصيل إلى ErvenowCart ثم الدفع من /cart
 */
(function (global) {
  "use strict";

  function validateSaPhone(phone) {
    var d = String(phone || "").replace(/\s/g, "").replace(/\D/g, "");
    if (/^05\d{8}$/.test(d)) return d;
    if (/^9665\d{8}$/.test(d)) return "0" + d.slice(3);
    if (/^5\d{8}$/.test(d)) return "0" + d;
    return null;
  }

  function parsePrice(val) {
    var n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /**
   * @param {object} item
   * @param {{ redirect?: boolean, message?: string }} [opts]
   */
  function addServiceToCart(item, opts) {
    opts = opts || {};
    var cart = global.ErvenowCart;
    if (!cart || typeof cart.add !== "function") {
      return { ok: false, message: "السلة غير متوفرة — حمّل cart.js أولاً" };
    }
    var phone = validateSaPhone(item && item.customer_phone);
    if (!phone) {
      return { ok: false, message: "أدخل رقم جوال سعودي صحيح (05xxxxxxxx أو 9665xxxxxxxx)" };
    }
    item.customer_phone = phone;
    if (item.data && typeof item.data === "object") {
      item.data.customer_phone = phone;
    }
    var price = parsePrice(item.price);
    var zeroOk = { delivery: 1, restaurant: 1, food: 1 };
    if (price <= 0 && !zeroOk[item.type]) {
      return { ok: false, message: "حدد المواقع أو الخدمة لحساب السعر قبل الإضافة للسلة" };
    }
    item.price = price;
    item.payment_status = item.payment_status || "unpaid";
    var addResult = cart.add(item);
    if (!addResult || addResult.ok === false) {
      return {
        ok: false,
        message: (addResult && addResult.message) || "تعذر الإضافة للسلة",
      };
    }
    if (opts.redirect !== false) {
      var msg = opts.message || "تمت الإضافة للسلة — أكمل الدفع من /cart";
      try {
        sessionStorage.setItem("ervenow:cart-flash", msg);
      } catch (_) {}
      global.location.href = "/cart";
      return { ok: true };
    }
    return { ok: true, message: opts.message || "تمت الإضافة للسلة" };
  }

  global.ErvenowServiceCart = {
    validateSaPhone: validateSaPhone,
    parsePrice: parsePrice,
    add: addServiceToCart,
  };

  if (global.ErvenowCart) {
    global.ErvenowCart.addService = addServiceToCart;
  }
})(typeof window !== "undefined" ? window : global);
