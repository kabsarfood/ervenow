/**
 * ERVENOW — ثبات الشاشة (iOS Safari · Android · Edge)
 * ارتفاع حقيقي + منع التكبير + منع الاهتزاز الأفقي
 */
(function (global) {
  if (global.__ervViewportReady) return;
  global.__ervViewportReady = true;

  var VIEWPORT_LOCKED =
    "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover";

  var lockCount = 0;
  var savedScrollY = 0;
  var MOBILE_SHELL_MQ =
    "(max-width: 640px), ((max-width: 932px) and (max-height: 500px) and (pointer: coarse))";

  function isMobileShellViewport() {
    try {
      return global.matchMedia(MOBILE_SHELL_MQ).matches;
    } catch (e) {
      return global.innerWidth <= 640;
    }
  }

  function isPaymentFlowPath(path) {
    var p = path || global.location.pathname || "";
    return /^\/checkout(\/|$)/.test(p) || /^\/cart(\/|$)/.test(p) || /^\/pay(\/|$)/.test(p);
  }

  function mobileHeaderReservePx() {
    if (document.body && document.body.classList.contains("lp-home-premium")) return 98;
    if (document.body && document.body.classList.contains("guest-shell-page")) return 56;
    return 56;
  }

  function applyMobileShellHeaderVars() {
    var reserve = mobileHeaderReservePx();
    document.documentElement.style.setProperty("--erv-mobile-header-reserve", reserve + "px");
    document.documentElement.style.setProperty("--erv-mobile-header-h", reserve + "px");
    document.documentElement.style.setProperty("--erw-header-h", reserve + "px");
  }

  function bootMobileShell() {
    var root = document.documentElement;
    if (!isMobileShellViewport()) {
      root.classList.remove("erv-mobile-shell", "erv-mobile-no-nav");
      return;
    }
    root.classList.add("erv-mobile-shell");
    if (isPaymentFlowPath()) root.classList.add("erv-mobile-no-nav");
    else root.classList.remove("erv-mobile-no-nav");
    applyMobileShellHeaderVars();
  }

  function ensureBottomNavShell() {
    if (!isMobileShellViewport() || isPaymentFlowPath() || !document.body) return;
    var nav = document.getElementById("ervMobileBottomNav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "ervMobileBottomNav";
      nav.className = "erv-mobile-bottom-nav erv-mobile-bottom-nav--shell";
      nav.setAttribute("aria-label", "التنقل السريع");
      nav.setAttribute("aria-hidden", "true");
      document.body.appendChild(nav);
    }
  }

  function enforceViewportMeta() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      document.head.appendChild(meta);
    }
    if (meta.getAttribute("content") !== VIEWPORT_LOCKED) {
      meta.setAttribute("content", VIEWPORT_LOCKED);
    }
  }

  function clampHorizontalScroll() {
    var dx = global.scrollX || document.documentElement.scrollLeft || 0;
    if (dx !== 0) {
      global.scrollTo(0, global.scrollY || document.documentElement.scrollTop || 0);
    }
  }

  function resetViewportScale() {
    enforceViewportMeta();
    clampHorizontalScroll();
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    meta.setAttribute("content", VIEWPORT_LOCKED + ", shrink-to-fit=no");
    global.setTimeout(function () {
      meta.setAttribute("content", VIEWPORT_LOCKED);
      setViewportVars();
      clampHorizontalScroll();
    }, 280);
  }

  function syncSiteHeaderHeight() {
    if (document.documentElement.classList.contains("erv-mobile-shell")) {
      applyMobileShellHeaderVars();
      return;
    }
    var header = document.querySelector(".dash-site-header, .lp-header.lp-header--refined");
    if (!header) return;
    var rect = header.getBoundingClientRect();
    var h = Math.ceil(rect.height);
    if (h > 0) {
      document.documentElement.style.setProperty("--erw-header-h", h + "px");
      document.documentElement.style.setProperty("--erv-mobile-header-h", h + "px");
    }
  }

  function setViewportVars() {
    var vv = global.visualViewport;
    var h = vv && vv.height > 0 ? vv.height : global.innerHeight;
    var w = vv && vv.width > 0 ? vv.width : global.innerWidth;
    var root = document.documentElement;
    root.style.setProperty("--erw-vh", h * 0.01 + "px");
    root.style.setProperty("--erw-vw", w * 0.01 + "px");
    root.style.setProperty("--erw-viewport-h", h + "px");
    root.style.setProperty("--erw-viewport-w", w + "px");
    root.classList.add("erw-viewport-ready");
    syncSiteHeaderHeight();
    if (vv && vv.scale > 1.02) resetViewportScale();
  }

  function lockScroll() {
    lockCount += 1;
    if (lockCount > 1) return;
    savedScrollY = global.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.add("erw-scroll-locked");
    document.body.style.top = "-" + savedScrollY + "px";
  }

  function unlockScroll() {
    if (lockCount <= 0) return;
    lockCount -= 1;
    if (lockCount > 0) return;
    document.body.classList.remove("erw-scroll-locked");
    document.body.style.top = "";
    global.scrollTo(0, savedScrollY);
  }

  function blockPinchZoom(e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }

  function blockGestureZoom(e) {
    e.preventDefault();
  }

  enforceViewportMeta();
  bootMobileShell();
  setViewportVars();
  clampHorizontalScroll();

  document.addEventListener("gesturestart", blockGestureZoom, { passive: false });
  document.addEventListener("gesturechange", blockGestureZoom, { passive: false });
  document.addEventListener("gestureend", blockGestureZoom, { passive: false });
  document.addEventListener("touchmove", blockPinchZoom, { passive: false });
  global.addEventListener("scroll", clampHorizontalScroll, { passive: true });
  document.addEventListener("scroll", clampHorizontalScroll, { passive: true });

  global.addEventListener("resize", function () {
    bootMobileShell();
    setViewportVars();
    clampHorizontalScroll();
  }, { passive: true });
  global.addEventListener("orientationchange", function () {
    global.setTimeout(function () {
      resetViewportScale();
      syncSiteHeaderHeight();
    }, 120);
    global.setTimeout(syncSiteHeaderHeight, 320);
  });
  global.addEventListener("pageshow", function (ev) {
    if (ev.persisted) resetViewportScale();
  });

  if (global.visualViewport) {
    global.visualViewport.addEventListener("resize", function () {
      setViewportVars();
      clampHorizontalScroll();
    }, { passive: true });
    global.visualViewport.addEventListener("scroll", clampHorizontalScroll, { passive: true });
  }

  global.addEventListener("DOMContentLoaded", function () {
    bootMobileShell();
    applyMobileShellHeaderVars();
    ensureBottomNavShell();
    syncSiteHeaderHeight();
  });

  if (typeof ResizeObserver !== "undefined") {
    global.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll(".dash-site-header, .lp-header.lp-header--refined").forEach(function (header) {
        var ro = new ResizeObserver(function () {
          syncSiteHeaderHeight();
        });
        ro.observe(header);
      });
    });
  }

  global.ErvenowViewport = {
    refresh: setViewportVars,
    resetScale: resetViewportScale,
    clampHorizontal: clampHorizontalScroll,
    lockScroll: lockScroll,
    unlockScroll: unlockScroll,
    syncHeaderHeight: syncSiteHeaderHeight,
    bootMobileShell: bootMobileShell,
    isPaymentFlowPath: isPaymentFlowPath,
  };
})(window);
