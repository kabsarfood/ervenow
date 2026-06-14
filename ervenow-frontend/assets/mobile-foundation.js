/**
 * ERVENOW Mobile Excellence — Phase A: Mobile Foundation + Plus Bottom Nav
 */
(function (global) {
  var MQ =
    "(max-width: 640px), ((max-width: 932px) and (max-height: 500px) and (pointer: coarse))";

  var NAV_LEFT = [
    { key: "home", href: "/", label: "الرئيسية", icon: "🏠", match: [/^\/$/, /^\/index\.html$/] },
    {
      key: "explore",
      href: "/start-now.html",
      label: "استكشاف",
      icon: "🔍",
      match: [/^\/start-now/, /^\/dashboard/, /^\/browse/, /^\/restaurants/, /^\/stores/, /^\/services/, /^\/delivery/],
    },
  ];

  var NAV_RIGHT = [
    { key: "orders", href: "/my-orders", label: "طلباتي", icon: "📋", match: [/^\/my-orders/, /^\/order/, /^\/track/], badgeId: "ervMobileNavOrdersBadge" },
    {
      key: "account",
      href: "/login?role=customer",
      label: "حسابي",
      icon: "👤",
      match: [/^\/login/, /^\/wallet/],
      id: "ervMobileNavAccount",
    },
  ];

  var SHEET_OPTIONS = [
    { key: "restaurants", href: "/restaurants", label: "مطاعم", icon: "🍽️" },
    { key: "stores", href: "/stores", label: "متاجر", icon: "🛒" },
    { key: "services", href: "/services", label: "خدمات", icon: "🔧" },
    { key: "delivery", href: "/delivery-services.html", label: "توصيل", icon: "🚚" },
  ];

  var NAV_MATCH = NAV_LEFT.concat(NAV_RIGHT).concat([
    { key: "cart", match: [/^\/checkout/, /^\/cart/] },
  ]);

  var sheetBound = false;
  var sheetOpen = false;

  function isMobile() {
    try {
      return global.matchMedia(MQ).matches;
    } catch (e) {
      return global.innerWidth <= 640;
    }
  }

  function isPaymentFlowPath(path) {
    if (global.ErvenowViewport && typeof global.ErvenowViewport.isPaymentFlowPath === "function") {
      return global.ErvenowViewport.isPaymentFlowPath(path);
    }
    var p = path || global.location.pathname || "";
    return /^\/checkout(\/|$)/.test(p) || /^\/cart(\/|$)/.test(p) || /^\/pay(\/|$)/.test(p);
  }

  function hasToken() {
    try {
      return !!(global.PlatformAPI && global.PlatformAPI.getToken && global.PlatformAPI.getToken());
    } catch (e) {
      return false;
    }
  }

  function accountHref() {
    if (hasToken()) return "/dashboard";
    return "/login?role=customer";
  }

  function ordersHref() {
    if (global.ErvenowMobileOrdersNavBadge && typeof global.ErvenowMobileOrdersNavBadge.ordersHref === "function") {
      return global.ErvenowMobileOrdersNavBadge.ordersHref();
    }
    if (hasToken()) return "/my-orders";
    return "/login?role=customer&next=" + encodeURIComponent("/my-orders");
  }

  function activeKeyForPath(path) {
    var p = path || global.location.pathname || "/";
    if (/^\/dashboard/.test(p)) {
      return hasToken() ? "account" : "explore";
    }
    for (var i = 0; i < NAV_MATCH.length; i++) {
      var item = NAV_MATCH[i];
      for (var j = 0; j < item.match.length; j++) {
        if (item.match[j].test(p)) return item.key;
      }
    }
    return "";
  }

  function itemHref(item) {
    if (item.key === "account") return accountHref();
    if (item.key === "orders") return ordersHref();
    return item.href;
  }

  function buildItemHtml(item) {
    var href = itemHref(item);
    var html =
      '<a class="erv-mobile-bottom-nav__item" href="' +
      href +
      '" data-erv-nav="' +
      item.key +
      '"' +
      (item.id ? ' id="' + item.id + '"' : "") +
      ">" +
      '<span class="erv-mobile-bottom-nav__icon" aria-hidden="true">' +
      item.icon +
      "</span>" +
      "<span>" +
      item.label +
      "</span>";
    if (item.badgeId) {
      html += '<span class="erv-mobile-bottom-nav__badge" id="' + item.badgeId + '" hidden>0</span>';
    }
    html += "</a>";
    return html;
  }

  var NAV_CURVE_FILL =
    "M0,12 H108 C124,12 136,12 145,6 C154,0 170,-16 195,-16 C220,-16 236,0 245,6 C254,12 266,12 282,12 H390 V84 H0 Z";
  var NAV_CURVE_LINE =
    "M0,12 H108 C124,12 136,12 145,6 C154,0 170,-16 195,-16 C220,-16 236,0 245,6 C254,12 266,12 282,12 H390";

  function buildNavInnerHtml() {
    var start = "";
    NAV_LEFT.forEach(function (item) {
      start += buildItemHtml(item);
    });
    var end = "";
    NAV_RIGHT.forEach(function (item) {
      end += buildItemHtml(item);
    });
    return (
      '<div class="erv-mobile-bottom-nav__bar">' +
      '<svg class="erv-mobile-bottom-nav__curve" viewBox="0 -20 390 104" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="erv-mobile-bottom-nav__curve-fill" d="' +
      NAV_CURVE_FILL +
      '" />' +
      '<path class="erv-mobile-bottom-nav__curve-line" d="' +
      NAV_CURVE_LINE +
      '" />' +
      "</svg>" +
      '<div class="erv-mobile-bottom-nav__items">' +
      '<div class="erv-mobile-bottom-nav__cluster erv-mobile-bottom-nav__cluster--start">' +
      start +
      "</div>" +
      '<div class="erv-mobile-bottom-nav__cluster erv-mobile-bottom-nav__cluster--spacer" aria-hidden="true"></div>' +
      '<div class="erv-mobile-bottom-nav__cluster erv-mobile-bottom-nav__cluster--end">' +
      end +
      "</div>" +
      "</div>" +
      "</div>" +
      '<button type="button" class="erv-mobile-bottom-nav__fab" id="ervPlusNavFab" aria-label="طلب جديد" aria-haspopup="dialog" aria-expanded="false" aria-controls="ervPlusNavSheet">' +
      '<span class="erv-mobile-bottom-nav__fab-icon" aria-hidden="true">+</span>' +
      "</button>"
    );
  }

  function buildSheetHtml() {
    var opts = "";
    SHEET_OPTIONS.forEach(function (opt) {
      opts +=
        '<a class="erv-plus-nav-sheet__option erv-plus-nav-sheet__option--' +
        opt.key +
        '" href="' +
        opt.href +
        '">' +
        '<span class="erv-plus-nav-sheet__option-icon" aria-hidden="true">' +
        opt.icon +
        "</span>" +
        "<span>" +
        opt.label +
        "</span>" +
        "</a>";
    });
    return (
      '<div id="ervPlusNavSheet" class="erv-plus-nav-sheet" hidden aria-hidden="true">' +
      '<div class="erv-plus-nav-sheet__backdrop" data-erv-plus-sheet-close tabindex="-1" aria-hidden="true"></div>' +
      '<div class="erv-plus-nav-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="ervPlusNavSheetTitle">' +
      '<div class="erv-plus-nav-sheet__handle" aria-hidden="true"></div>' +
      '<h2 class="erv-plus-nav-sheet__title" id="ervPlusNavSheetTitle">ماذا تريد طلبه؟</h2>' +
      '<div class="erv-plus-nav-sheet__grid">' +
      opts +
      "</div>" +
      '<button type="button" class="erv-plus-nav-sheet__cancel" data-erv-plus-sheet-close>إلغاء</button>' +
      "</div>" +
      "</div>"
    );
  }

  function buildCartFloatHtml() {
    return (
      '<a id="ervPlusNavCartFloat" class="erv-plus-nav-cart-float" href="/checkout" hidden aria-label="السلة">' +
      '<span class="erv-plus-nav-cart-float__icon" aria-hidden="true">🛒</span>' +
      "<span>السلة</span>" +
      '<span class="erv-plus-nav-cart-float__badge" id="ervPlusNavCartFloatBadge">0</span>' +
      "</a>"
    );
  }

  function getSheet() {
    return document.getElementById("ervPlusNavSheet");
  }

  function openSheet() {
    var sheet = getSheet();
    var fab = document.getElementById("ervPlusNavFab");
    if (!sheet || sheetOpen) return;
    sheetOpen = true;
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    sheet.classList.add("is-open");
    document.documentElement.classList.add("erv-plus-nav-sheet-open");
    if (fab) fab.setAttribute("aria-expanded", "true");
  }

  function closeSheet() {
    var sheet = getSheet();
    var fab = document.getElementById("ervPlusNavFab");
    if (!sheet || !sheetOpen) return;
    sheetOpen = false;
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("erv-plus-nav-sheet-open");
    if (fab) fab.setAttribute("aria-expanded", "false");
    global.setTimeout(function () {
      if (!sheetOpen) sheet.hidden = true;
    }, 320);
  }

  function bindSheet() {
    if (sheetBound) return;
    var sheet = getSheet();
    if (!sheet) return;
    sheetBound = true;
    var fab = document.getElementById("ervPlusNavFab");
    if (fab) {
      fab.addEventListener("click", function (e) {
        e.preventDefault();
        if (sheetOpen) closeSheet();
        else openSheet();
      });
    }
    sheet.querySelectorAll("[data-erv-plus-sheet-close]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        closeSheet();
      });
    });
    global.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sheetOpen) closeSheet();
    });
  }

  function ensureSheet() {
    if (document.getElementById("ervPlusNavSheet")) return;
    document.body.insertAdjacentHTML("beforeend", buildSheetHtml());
    bindSheet();
  }

  function ensureCartFloat() {
    if (document.getElementById("ervPlusNavCartFloat")) return;
    document.body.insertAdjacentHTML("beforeend", buildCartFloatHtml());
  }

  function removePlusExtras() {
    closeSheet();
    var floatEl = document.getElementById("ervPlusNavCartFloat");
    if (floatEl) floatEl.remove();
    var sheet = getSheet();
    if (sheet) sheet.remove();
    sheetBound = false;
    sheetOpen = false;
  }

  function syncCartBadge() {
    var src = document.getElementById("cartCount");
    var floatEl = document.getElementById("ervPlusNavCartFloat");
    var badge = document.getElementById("ervPlusNavCartFloatBadge");
    if (!floatEl || !badge) return;
    var n = src ? String(src.textContent || "0").trim() : "0";
    var empty = src && src.getAttribute("data-empty") === "true";
    if (!n || n === "0" || empty) {
      floatEl.hidden = true;
      badge.textContent = "0";
    } else {
      floatEl.hidden = false;
      badge.textContent = n;
    }
  }

  function setActiveNav() {
    var key = activeKeyForPath(global.location.pathname);
    var nav = document.getElementById("ervMobileBottomNav");
    if (!nav) return;
    nav.querySelectorAll(".erv-mobile-bottom-nav__item").forEach(function (el) {
      var k = el.getAttribute("data-erv-nav");
      el.classList.toggle("is-active", k === key);
    });
    var acc = document.getElementById("ervMobileNavAccount");
    if (acc) acc.setAttribute("href", accountHref());
    var ordersLink = nav.querySelector('.erv-mobile-bottom-nav__item[data-erv-nav="orders"]');
    if (ordersLink) ordersLink.setAttribute("href", ordersHref());
  }

  function mountBottomNav() {
    if (isPaymentFlowPath()) {
      unmountBottomNav();
      return;
    }
    var nav = document.getElementById("ervMobileBottomNav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "ervMobileBottomNav";
      nav.className = "erv-mobile-bottom-nav erv-mobile-bottom-nav--shell erv-mobile-bottom-nav--plus";
      nav.setAttribute("aria-label", "التنقل السريع");
      document.body.appendChild(nav);
    }
    if (!nav.classList.contains("erv-mobile-bottom-nav--ready") || !nav.querySelector(".erv-mobile-bottom-nav__curve")) {
      nav.innerHTML = buildNavInnerHtml();
      nav.classList.add("erv-mobile-bottom-nav--ready", "erv-mobile-bottom-nav--plus");
      nav.classList.remove("erv-mobile-bottom-nav--shell");
      nav.removeAttribute("aria-hidden");
      ensureSheet();
      ensureCartFloat();
      bindSheet();
    }
  }

  function unmountBottomNav() {
    removePlusExtras();
    var nav = document.getElementById("ervMobileBottomNav");
    if (nav) nav.remove();
  }

  function syncShellState() {
    if (global.ErvenowViewport && typeof global.ErvenowViewport.bootMobileShell === "function") {
      global.ErvenowViewport.bootMobileShell();
    }
  }

  function enable() {
    syncShellState();
    document.documentElement.classList.add("erv-plus-nav-active");
    document.body.classList.add("erv-mobile-foundation");
    if (!isPaymentFlowPath()) mountBottomNav();
    else unmountBottomNav();
    setActiveNav();
    syncCartBadge();
    if (global.ErvenowMobileOrdersNavBadge && typeof global.ErvenowMobileOrdersNavBadge.refresh === "function") {
      global.ErvenowMobileOrdersNavBadge.refresh();
    }
    if (global.ErvenowMobileHarmony && typeof global.ErvenowMobileHarmony.init === "function") {
      global.ErvenowMobileHarmony.init();
    }
  }

  function disable() {
    document.documentElement.classList.remove("erv-plus-nav-active", "erv-plus-nav-sheet-open");
    document.body.classList.remove("erv-mobile-foundation");
    removePlusExtras();
    var nav = document.getElementById("ervMobileBottomNav");
    if (nav && nav.classList.contains("erv-mobile-bottom-nav--ready")) {
      nav.classList.remove("erv-mobile-bottom-nav--ready");
      nav.classList.add("erv-mobile-bottom-nav--shell");
      nav.innerHTML = "";
      nav.setAttribute("aria-hidden", "true");
    }
  }

  function apply() {
    if (isMobile()) enable();
    else disable();
  }

  function observeCart() {
    var src = document.getElementById("cartCount");
    if (!src || !global.MutationObserver) return;
    var obs = new global.MutationObserver(syncCartBadge);
    obs.observe(src, { childList: true, characterData: true, attributes: true, subtree: true });
  }

  function init() {
    apply();
    observeCart();
    try {
      var mq = global.matchMedia(MQ);
      if (mq.addEventListener) mq.addEventListener("change", apply);
      else if (mq.addListener) mq.addListener(apply);
    } catch (e) {}
    global.addEventListener("resize", apply);
    global.addEventListener("ervenow:auth-changed", function () {
      setActiveNav();
      syncCartBadge();
      if (global.ErvenowMobileOrdersNavBadge && typeof global.ErvenowMobileOrdersNavBadge.refresh === "function") {
        global.ErvenowMobileOrdersNavBadge.refresh();
      }
    });
  }

  global.ErvenowMobileFoundation = {
    init: init,
    apply: apply,
    syncCartBadge: syncCartBadge,
    isMobile: isMobile,
    isPaymentFlowPath: isPaymentFlowPath,
    openPlusSheet: openSheet,
    closePlusSheet: closeSheet,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
