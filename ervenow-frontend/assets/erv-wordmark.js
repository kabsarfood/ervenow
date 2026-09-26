/**
 * يستبدل شعار الصورة واسم ERVENOW النصي بالكلمة المركبة.
 */
(function (global) {
  "use strict";

  var MARK =
    '<span class="erv-wordmark" dir="ltr">' +
    '<span class="erv-wordmark__name">' +
    '<span class="erv-wordmark__erve">ERVE</span>' +
    '<span class="erv-wordmark__now">NOW</span>' +
    "</span>" +
    '<span class="erv-wordmark__tag">PLATFORM</span>' +
    "</span>";

  var HOSTS =
    ".dash-site-header__logo, .lp-brand__name, .lp-footer__brand, .pf-header__logo, .pf-header__center-brand, .pf-sidebar__brand, .admin-login-card__logo, .adm-brand h1, aside.sidebar > h2, #pvBrandText";

  function isPlainBrand(el) {
    if (!el || el.dataset.ervWordmark === "1" || el.querySelector(".erv-wordmark")) return false;
    var raw = String(el.textContent || "").replace(/\s+/g, "");
    return raw === "ERVENOW";
  }

  function upgrade(root) {
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('img[src*="ervenow-logo"], #ervBrandLogo, .lp-header__logo-img, .erv-harmony-identity__logo').forEach(function (img) {
      if (!img || !img.parentNode || img.dataset.ervWordmark === "1") return;
      var holder = document.createElement("span");
      holder.innerHTML = MARK;
      img.dataset.ervWordmark = "1";
      img.parentNode.replaceChild(holder.firstChild, img);
    });

    root.querySelectorAll(HOSTS).forEach(function (el) {
      if (!isPlainBrand(el)) return;
      el.dataset.ervWordmark = "1";
      el.classList.add("erv-wordmark-host");
      el.innerHTML = MARK;
      var mid = el.closest && el.closest(".lp-header__brand-mid");
      if (mid) {
        var tag = mid.querySelector(".lp-brand__tag");
        if (tag) tag.hidden = true;
      }
    });
  }

  function boot() {
    upgrade(document);
    if (!global.MutationObserver || global.__ervWordmarkObserver) return;
    global.__ervWordmarkObserver = new MutationObserver(function () {
      upgrade(document);
    });
    global.__ervWordmarkObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  global.ErvenowWordmark = { html: function () { return MARK; }, upgrade: upgrade };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
