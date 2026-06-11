/**
 * ERVENOW Mobile Excellence — Phase A: Mobile Foundation
 */
(function (global) {
  var MQ =
    "(max-width: 640px), ((max-width: 932px) and (max-height: 500px) and (pointer: coarse))";

  var NAV_ITEMS = [
    { key: "home", href: "/", label: "الرئيسية", icon: "🏠", match: [/^\/$/, /^\/index\.html$/] },
    {
      key: "explore",
      href: "/start-now.html",
      label: "استكشاف",
      icon: "🔍",
      match: [/^\/start-now/, /^\/dashboard/, /^\/browse/, /^\/restaurants/, /^\/stores/, /^\/services/, /^\/delivery/],
    },
    { key: "cart", href: "/checkout", label: "السلة", icon: "🛒", match: [/^\/checkout/, /^\/cart/] },
    { key: "orders", href: "/my-orders", label: "طلباتي", icon: "📋", match: [/^\/my-orders/, /^\/order/, /^\/track/] },
    {
      key: "account",
      href: "/login?role=customer",
      label: "الحساب",
      icon: "👤",
      match: [/^\/login/, /^\/wallet/],
      id: "ervMobileNavAccount",
    },
  ];

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

  function activeKeyForPath(path) {
    var p = path || global.location.pathname || "/";
    if (/^\/dashboard/.test(p)) {
      return hasToken() ? "account" : "explore";
    }
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      var item = NAV_ITEMS[i];
      for (var j = 0; j < item.match.length; j++) {
        if (item.match[j].test(p)) return item.key;
      }
    }
    return "";
  }

  function buildNavInnerHtml() {
    var html = "";
    NAV_ITEMS.forEach(function (item) {
      var href = item.key === "account" ? accountHref() : item.href;
      html +=
        '<a class="erv-mobile-bottom-nav__item" href="' +
        href +
        '" data-erv-nav="' +
        item.key +
        '"' +
        (item.id ? ' id="' + item.id + '"' : "") +
        '>' +
        '<span class="erv-mobile-bottom-nav__icon" aria-hidden="true">' +
        item.icon +
        "</span>" +
        "<span>" +
        item.label +
        "</span>";
      if (item.key === "cart") {
        html += '<span class="erv-mobile-bottom-nav__badge" id="ervMobileNavCartBadge" hidden>0</span>';
      }
      html += "</a>";
    });
    return html;
  }

  function syncCartBadge() {
    var src = document.getElementById("cartCount");
    var dst = document.getElementById("ervMobileNavCartBadge");
    if (!dst) return;
    var n = src ? String(src.textContent || "0").trim() : "0";
    var empty = src && src.getAttribute("data-empty") === "true";
    if (!n || n === "0" || empty) {
      dst.hidden = true;
      dst.textContent = "0";
    } else {
      dst.hidden = false;
      dst.textContent = n;
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
      nav.className = "erv-mobile-bottom-nav erv-mobile-bottom-nav--shell";
      nav.setAttribute("aria-label", "التنقل السريع");
      document.body.appendChild(nav);
    }
    if (!nav.classList.contains("erv-mobile-bottom-nav--ready")) {
      nav.innerHTML = buildNavInnerHtml();
      nav.classList.add("erv-mobile-bottom-nav--ready");
      nav.classList.remove("erv-mobile-bottom-nav--shell");
      nav.removeAttribute("aria-hidden");
    }
  }

  function unmountBottomNav() {
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
    document.body.classList.add("erv-mobile-foundation");
    if (!isPaymentFlowPath()) mountBottomNav();
    else unmountBottomNav();
    setActiveNav();
    syncCartBadge();
    if (global.ErvenowMobileHarmony && typeof global.ErvenowMobileHarmony.init === "function") {
      global.ErvenowMobileHarmony.init();
    }
  }

  function disable() {
    document.body.classList.remove("erv-mobile-foundation");
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
    });
  }

  global.ErvenowMobileFoundation = {
    init: init,
    apply: apply,
    syncCartBadge: syncCartBadge,
    isMobile: isMobile,
    isPaymentFlowPath: isPaymentFlowPath,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
