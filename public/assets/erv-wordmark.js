/**
 * يستبدل شعار الصورة واسم ERVENOW النصي بالكلمة المركبة.
 */
(function (global) {
  "use strict";

  var MARK =
    '<span class="erv-wordmark" dir="ltr" role="img" aria-label="ERVENOW PLATFORM">' +
    '<span class="erv-wordmark__name" aria-hidden="true">' +
    '<span class="erv-wordmark__erve"><span class="erv-wordmark__e"><i></i><i></i><i></i></span>RVE</span>' +
    '<span class="erv-wordmark__now">N<svg class="erv-wordmark__pin" viewBox="0 0 24 32" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M12 1.5C7.1 1.5 3.2 5.5 3.2 10.5 3.2 16.6 12 30.4 12 30.4S20.8 16.6 20.8 10.5C20.8 5.5 16.9 1.5 12 1.5zm0 12.8a3.4 3.4 0 1 1 0-6.8 3.4 3.4 0 0 1 0 6.8z"/></svg>W</span>' +
    "</span>" +
    '<span class="erv-wordmark__tag" aria-hidden="true">PLATFORM</span>' +
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

    root.querySelectorAll(".erv-wordmark").forEach(function (el) {
      if (el.querySelector(".erv-wordmark__pin")) return;
      var holder = document.createElement("span");
      holder.innerHTML = MARK;
      if (el.parentNode) el.parentNode.replaceChild(holder.firstChild, el);
    });

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
