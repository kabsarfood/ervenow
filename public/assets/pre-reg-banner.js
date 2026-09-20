/**
 * ERVENOW — شريط التسجيل المسبق
 * معطّل حالياً على كل الشاشات (جوال / تابلت / كمبيوتر) بطلب المنتج.
 */
(function (global) {
  if (global.ErvenowPreRegBanner) return;

  var BAR_ID = "ervPreRegBanner";
  var CSS_ID = "ervPreRegBannerCss";

  function removeExisting() {
    var bar = document.getElementById(BAR_ID);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    var css = document.getElementById(CSS_ID);
    if (css && css.parentNode) css.parentNode.removeChild(css);
    document.querySelectorAll(".erv-prereg-banner").forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function noop() {
    removeExisting();
  }

  global.ErvenowPreRegBanner = { boot: noop, render: noop, remove: removeExisting };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", noop);
  } else {
    noop();
  }
})(window);
