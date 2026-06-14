/**
 * ERVENOW — ثبات الشاشة (iOS Safari · Android · Edge)
 * ارتفاع حقيقي + منع التكبير + منع الاهتزاز الأفقي
 */
(function (global) {
  if (global.__ervViewportReady) return;
  global.__ervViewportReady = true;

  /** يُرفَع عند كل تحديث Mobile Shell لإجبار تحميل نسخة جديدة (تجاوز cache الجوال) */
  var ERV_SHELL_ASSET_VER = "20260622";

  function shellAssetUrl(path) {
    var p = String(path || "");
    if (!p) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + "erv=" + ERV_SHELL_ASSET_VER;
  }

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
    if (document.body && document.body.classList.contains("lp-home-premium")) return 56;
    if (document.body && document.body.classList.contains("guest-shell-page")) return 56;
    return 56;
  }

  function applyMobileShellHeaderVars() {
    var reserve = mobileHeaderReservePx();
    document.documentElement.style.setProperty("--erv-mobile-header-reserve", reserve + "px");
    document.documentElement.style.setProperty("--erv-mobile-header-h", reserve + "px");
    document.documentElement.style.setProperty("--erw-header-h", reserve + "px");
  }

  function injectMobileFoundationCss() {
    if (!isMobileShellViewport() || isPaymentFlowPath()) return;
    if (document.body && document.body.classList.contains("erv-preview-lab")) return;
    if (document.querySelector('link[href*="mobile-foundation.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = shellAssetUrl("/assets/mobile-foundation.css");
    document.head.appendChild(link);
  }

  function ensureMobileFoundationJs() {
    if (!isMobileShellViewport() || isPaymentFlowPath()) return;
    if (document.body && document.body.classList.contains("erv-preview-lab")) return;
    if (document.querySelector('script[src*="mobile-foundation.js"]')) return;
    var s = document.createElement("script");
    s.src = shellAssetUrl("/assets/mobile-foundation.js");
    s.defer = true;
    document.head.appendChild(s);
  }

  function ensureMobileOrdersNavBadgeJs() {
    if (!isMobileShellViewport() || isPaymentFlowPath()) return;
    if (document.body && document.body.classList.contains("erv-preview-lab")) return;
    if (document.querySelector('script[src*="mobile-orders-nav-badge.js"]')) return;
    var s = document.createElement("script");
    s.src = shellAssetUrl("/assets/mobile-orders-nav-badge.js");
    s.defer = true;
    document.head.appendChild(s);
  }

  function injectMobileHarmonyCritical() {
    if (!isMobileShellViewport() || isPaymentFlowPath()) return;
    if (document.body && document.body.classList.contains("erv-preview-lab")) return;
    if (document.getElementById("ervMobileHarmonyCritical")) return;
    var el = document.createElement("style");
    el.id = "ervMobileHarmonyCritical";
    el.textContent =
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) .lp-header__actions," +
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) .dash-site-header__tools," +
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) .lp-draft-checkout-badge," +
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) #indexDraftBadge," +
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) .dash-header-cart," +
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) .dash-header-cart-btn," +
      "html.erv-mobile-shell:not(.erv-mobile-no-nav) #lpCartWrap{display:none!important;visibility:hidden!important;pointer-events:none!important}" +
      "html.erv-mobile-shell body.lp-home-premium .lp-header__top-row{display:grid!important;grid-template-columns:auto 1fr auto!important;align-items:center!important;direction:ltr!important}" +
      "html.erv-mobile-shell body.lp-home-premium .lp-header__top-row>.lp-header__logo-slot{grid-column:1!important;justify-self:start!important}" +
      "html.erv-mobile-shell body.lp-home-premium .lp-header__top-row>.lp-header__brand-mid{grid-column:2!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-self:center!important;text-align:center!important;direction:rtl!important}" +
      "html.erv-mobile-shell body.lp-home-premium .lp-header__top-row>.lp-header__menu-slot{grid-column:3!important;justify-self:end!important}" +
      "html.erv-mobile-shell body.guest-shell-page .dash-site-header__inner{display:grid!important;grid-template-columns:auto 1fr auto!important;grid-template-areas:'logo identity menu'!important;align-items:center!important;direction:ltr!important}" +
      "html.erv-mobile-shell body.guest-shell-page .dash-site-header__brand{grid-area:logo!important}" +
      "html.erv-mobile-shell body.guest-shell-page .erv-harmony-identity{grid-area:identity!important}" +
      "html.erv-mobile-shell body.guest-shell-page .erv-harmony-menu{grid-area:menu!important;justify-self:end!important}";
    document.head.appendChild(el);
    if (!document.querySelector('link[href*="mobile-harmony.css"]')) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = shellAssetUrl("/assets/mobile-harmony.css");
      document.head.appendChild(link);
    }
  }

  function bootMobileShell() {
    var root = document.documentElement;
    if (document.body && document.body.classList.contains("erv-preview-lab")) {
      root.classList.remove("erv-mobile-shell", "erv-mobile-no-nav");
      return;
    }
    if (!isMobileShellViewport()) {
      root.classList.remove("erv-mobile-shell", "erv-mobile-no-nav");
      return;
    }
    root.classList.add("erv-mobile-shell");
    if (isPaymentFlowPath()) root.classList.add("erv-mobile-no-nav");
    else root.classList.remove("erv-mobile-no-nav");
    applyMobileShellHeaderVars();
    injectMobileFoundationCss();
    injectMobileHarmonyCritical();
  }

  function ensureBottomNavShell() {
    if (!isMobileShellViewport() || isPaymentFlowPath() || !document.body) return;
    var nav = document.getElementById("ervMobileBottomNav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "ervMobileBottomNav";
      nav.className = "erv-mobile-bottom-nav erv-mobile-bottom-nav--shell erv-mobile-bottom-nav--plus";
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
    ensureMobileFoundationJs();
    ensureMobileOrdersNavBadgeJs();
    if (isMobileShellViewport() && !document.querySelector('script[src*="mobile-harmony.js"]')) {
      var hs = document.createElement("script");
      hs.src = shellAssetUrl("/assets/mobile-harmony.js");
      hs.defer = true;
      document.head.appendChild(hs);
    }
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
    shellAssetUrl: shellAssetUrl,
    shellAssetVer: ERV_SHELL_ASSET_VER,
  };

  /** وضع الصيانة — يغطي صفحات HTML المنشورة على CDN حتى لو تجاوزت بوابة الخادم */
  var ADMIN_PANEL_PATHS = [
    "/admin-dashboard",
    "/admin-finance",
    "/admin-debts",
    "/admin-approvals",
    "/admin-settings",
    "/admin-branding",
    "/admin-categories",
    "/admin-commissions",
    "/admin-withdrawals",
    "/admin/",
  ];

  function isDevHost(hostname) {
    var h = String(hostname || "").toLowerCase().split(":")[0];
    if (!h) return true;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
    if (h.endsWith(".local")) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
    return false;
  }

  function isProdMaintenanceHost(hostname) {
    var h = String(hostname || "").toLowerCase().split(":")[0];
    return h === "ervenow.com" || h === "www.ervenow.com";
  }

  function isAdminPanelPathClient(path) {
    var lower = String(path || "").split("?")[0].toLowerCase();
    for (var i = 0; i < ADMIN_PANEL_PATHS.length; i++) {
      var prefix = ADMIN_PANEL_PATHS[i];
      if (prefix.endsWith("/")) {
        if (lower.indexOf(prefix) === 0) return true;
      } else if (lower === prefix || lower.indexOf(prefix + "/") === 0) {
        return true;
      }
    }
    return false;
  }

  function showMaintenancePage() {
    if (global.__ervMaintenanceShown) return;
    global.__ervMaintenanceShown = true;
    try {
      global.stop && global.stop();
    } catch (e) {}
    var html =
      '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
      '<meta name="robots" content="noindex,nofollow"/>' +
      '<title>المنصة تحت التطوير والصيانة | ERVENOW</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet"/>' +
      '<style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;' +
      'font-family:Cairo,sans-serif;background:linear-gradient(160deg,#f8f4ef 0%,#e8ddd2 100%);color:#2b1f16}' +
      '.box{text-align:center;padding:32px 28px;max-width:420px}h1{font-size:1.75rem;font-weight:800;color:#5b371d;margin:0 0 12px}' +
      'p{margin:0;font-size:1.05rem;color:#6f5441;line-height:1.6}</style></head><body><div class="box">' +
      "<h1>المنصة تحت التطوير والصيانة</h1>" +
      "<p>نعمل على تحسين المنصة. نعتذر عن الإزعاج ونعود قريباً.</p>" +
      "</div></body></html>";
    document.open();
    document.write(html);
    document.close();
  }

  function checkSiteMaintenance() {
    if (isDevHost(global.location.hostname)) return;
    if (!isProdMaintenanceHost(global.location.hostname)) return;
    if (isAdminPanelPathClient(global.location.pathname)) return;
    var base = global.__ERVENOW_API_BASE__ != null ? String(global.__ERVENOW_API_BASE__).replace(/\/$/, "") : "";
    fetch(base + "/api/site-maintenance/status", { cache: "no-store", credentials: "omit" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && j.enabled) showMaintenancePage();
      })
      .catch(function () {});
  }

  checkSiteMaintenance();
  global.addEventListener("DOMContentLoaded", checkSiteMaintenance);
})(window);
