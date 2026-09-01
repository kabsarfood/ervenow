/**
 * ERVENOW Mobile Excellence — Phase A: Mobile Foundation + Plus Bottom Nav
 */
(function (global) {
  var MQ =
    "(max-width: 640px), ((max-width: 932px) and (max-height: 500px) and (pointer: coarse))";

  var NAV_LEFT = [
    { key: "home", href: "/", label: "الرئيسية", match: [/^\/$/, /^\/index\.html$/] },
    {
      key: "explore",
      href: "/start-now",
      label: "استكشاف",
      match: [/^\/start-now/, /^\/dashboard/, /^\/browse/, /^\/restaurants/, /^\/stores/, /^\/services/, /^\/delivery/],
    },
  ];

  var NAV_RIGHT = [
    { key: "orders", href: "/my-orders", label: "طلباتي", match: [/^\/my-orders/, /^\/order/, /^\/track/], badgeId: "ervMobileNavOrdersBadge" },
    {
      key: "account",
      href: "/login?role=customer",
      label: "حسابي",
      match: [/^\/login/, /^\/wallet/],
      id: "ervMobileNavAccount",
    },
  ];

  var SHEET_OPTIONS = [
    { key: "restaurants", href: "/restaurants", label: "مطاعم" },
    { key: "stores", href: "/stores", label: "متاجر" },
    { key: "services", href: "/services", label: "خدمات" },
    { key: "delivery", href: "/delivery-services.html", label: "توصيل" },
    { key: "gas", href: "/gas-delivery.html", label: "غاز" },
  ];

  var NAV_ICON_PATHS = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    explore: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/>',
    orders: '<path d="M9 5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
    account: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    restaurants: '<path d="M8 3v8M12 3v8M8 7h4"/><path d="M6 11h8l-1 10H7L6 11z"/>',
    stores: '<path d="M6 7h12l-1.2 12H7.2L6 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
    services: '<path d="M14.7 6.3a1 1 0 0 0-1.4 0l-7 7a1 1 0 0 0 0 1.4l2.6 2.6a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4z"/><path d="m16 4 4 4"/>',
    delivery: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l2 3v2h-6V10z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>',
    gas: '<path d="M8 21h8"/><path d="M12 17V8"/><path d="M9.5 10.5 12 8l2.5 2.5"/><rect x="8" y="4" width="8" height="4" rx="1"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h2l2.4 12.4a1 1 0 0 0 1 .8h9.8a1 1 0 0 0 1-.8L21 7H6"/>',
  };

  function navIconSvg(name) {
    var paths = NAV_ICON_PATHS[name] || NAV_ICON_PATHS.home;
    return (
      '<svg class="erv-nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      paths +
      "</svg>"
    );
  }

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

  function shouldHideBottomNav() {
    if (isPaymentFlowPath()) return true;
    return document.documentElement.classList.contains("erv-mobile-no-nav");
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
      '<span class="erv-mobile-bottom-nav__icon-wrap">' +
      '<span class="erv-mobile-bottom-nav__icon" aria-hidden="true">' +
      navIconSvg(item.key) +
      "</span></span>" +
      '<span class="erv-mobile-bottom-nav__label">' +
      item.label +
      "</span>";
    if (item.badgeId) {
      html += '<span class="erv-mobile-bottom-nav__badge" id="' + item.badgeId + '" hidden>0</span>';
    }
    html += "</a>";
    return html;
  }

  var NAV_DOCK_VERSION = "dock-v2";
  var NAV_DOCK_VB_W = 390;
  var NAV_DOCK_VB_H = 92;
  var dockResizeTimer;

  function readNavToken(name, fallback) {
    var raw = global.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return fallback;
    var n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  }

  function roundCurve(n) {
    return Math.round(n * 10) / 10;
  }

  /* V2 — شريط عائم + تجويف نصف دائري يحتضن FAB (نمط حراج / Material Cradle) */
  function buildDockPaths() {
    var vbW = NAV_DOCK_VB_W;
    var vbH = NAV_DOCK_VB_H;
    var cx = vbW / 2;
    var iw = Math.max(320, global.innerWidth || vbW);
    var scale = vbW / iw;

    var fabSize = readNavToken("--erv-nav-v2-fab-size", 56);
    var cradleGap = readNavToken("--erv-nav-v2-cradle-gap", 7);
    var dockH = readNavToken("--erv-nav-v2-dock-h", 58);
    var dockRadius = readNavToken("--erv-nav-v2-dock-radius", 22);
    var svgPxH = dockH + fabSize * 0.48 + cradleGap;
    var cornerR = Math.min((dockRadius / svgPxH) * vbH, 18);
    var pitR = (fabSize / 2 + cradleGap) * scale;
    var barTopY = vbH - (dockH / svgPxH) * vbH;
    var xL = cornerR;
    var xR = vbW - cornerR;
    var yB = vbH - cornerR;

    var fill =
      "M" +
      xL +
      "," +
      roundCurve(barTopY) +
      " H" +
      roundCurve(cx - pitR) +
      " A" +
      roundCurve(pitR) +
      "," +
      roundCurve(pitR) +
      " 0 0 0 " +
      roundCurve(cx + pitR) +
      "," +
      roundCurve(barTopY) +
      " H" +
      xR +
      " Q" +
      vbW +
      "," +
      roundCurve(barTopY) +
      " " +
      vbW +
      "," +
      roundCurve(barTopY + cornerR) +
      " V" +
      yB +
      " Q" +
      vbW +
      "," +
      vbH +
      " " +
      xR +
      "," +
      vbH +
      " H" +
      xL +
      " Q" +
      "0," +
      vbH +
      " 0," +
      yB +
      " V" +
      roundCurve(barTopY + cornerR) +
      " Q" +
      "0," +
      roundCurve(barTopY) +
      " " +
      xL +
      "," +
      roundCurve(barTopY) +
      " Z";

    var rim =
      "M" +
      xL +
      "," +
      roundCurve(barTopY) +
      " H" +
      roundCurve(cx - pitR) +
      " A" +
      roundCurve(pitR) +
      "," +
      roundCurve(pitR) +
      " 0 0 0 " +
      roundCurve(cx + pitR) +
      "," +
      roundCurve(barTopY) +
      " H" +
      xR;

    return { fill: fill, rim: rim };
  }

  function syncDockShape(nav) {
    if (!nav || !nav.querySelector(".erv-mobile-bottom-nav__shape-fill")) return;
    var paths = buildDockPaths();
    var fill = nav.querySelector(".erv-mobile-bottom-nav__shape-fill");
    var rim = nav.querySelector(".erv-mobile-bottom-nav__shape-rim");
    if (fill) fill.setAttribute("d", paths.fill);
    if (rim) rim.setAttribute("d", paths.rim);
  }

  function onDockResize() {
    if (!isMobile() || isPaymentFlowPath()) return;
    global.clearTimeout(dockResizeTimer);
    dockResizeTimer = global.setTimeout(function () {
      syncDockShape(document.getElementById("ervMobileBottomNav"));
    }, 100);
  }

  function tapHaptic() {
    try {
      if (global.navigator && typeof global.navigator.vibrate === "function") {
        global.navigator.vibrate(8);
      }
    } catch (e) {}
  }

  function buildNavInnerHtml() {
    var paths = buildDockPaths();
    var start = "";
    NAV_LEFT.forEach(function (item) {
      start += buildItemHtml(item);
    });
    var end = "";
    NAV_RIGHT.forEach(function (item) {
      end += buildItemHtml(item);
    });
    return (
      '<div class="erv-mobile-bottom-nav__float">' +
      '<div class="erv-mobile-bottom-nav__dock">' +
      '<svg class="erv-mobile-bottom-nav__shape" viewBox="0 0 390 92" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="erv-mobile-bottom-nav__shape-fill" d="' +
      paths.fill +
      '" />' +
      '<path class="erv-mobile-bottom-nav__shape-rim" d="' +
      paths.rim +
      '" />' +
      "</svg>" +
      '<div class="erv-mobile-bottom-nav__tabs">' +
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
      "</button>" +
      "</div>"
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
        navIconSvg(opt.key) +
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
      '<span class="erv-plus-nav-cart-float__icon" aria-hidden="true">' +
      navIconSvg("cart") +
      "</span>" +
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
        else {
          tapHaptic();
          openSheet();
        }
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
    if (shouldHideBottomNav()) {
      unmountBottomNav();
      return;
    }
    var nav = document.getElementById("ervMobileBottomNav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "ervMobileBottomNav";
      nav.className = "erv-mobile-bottom-nav erv-mobile-bottom-nav--shell erv-mobile-bottom-nav--v2";
      nav.setAttribute("aria-label", "التنقل السريع");
      document.body.appendChild(nav);
    }
    if (
      !nav.classList.contains("erv-mobile-bottom-nav--ready") ||
      !nav.querySelector(".erv-mobile-bottom-nav__shape-fill") ||
      !nav.querySelector(".erv-mobile-bottom-nav__icon-wrap") ||
      nav.getAttribute("data-erv-nav-version") !== NAV_DOCK_VERSION
    ) {
      nav.innerHTML = buildNavInnerHtml();
      nav.setAttribute("data-erv-nav-version", NAV_DOCK_VERSION);
      nav.classList.add("erv-mobile-bottom-nav--ready", "erv-mobile-bottom-nav--v2");
      nav.classList.remove("erv-mobile-bottom-nav--shell", "erv-mobile-bottom-nav--plus");
      nav.removeAttribute("aria-hidden");
      ensureSheet();
      ensureCartFloat();
      bindSheet();
    } else {
      syncDockShape(nav);
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
    if (!shouldHideBottomNav()) mountBottomNav();
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
    global.addEventListener("resize", onDockResize);
    global.addEventListener("orientationchange", onDockResize);
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
