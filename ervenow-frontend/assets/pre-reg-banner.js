/**
 * ERVENOW — شريط التسجيل المسبق على كامل المنصة
 * الترتيب: الشريط أعلى الصفحة، ثم الهيدر sticky أسفله (بدون تداخل على الجوال/التابلت).
 */
(function (global) {
  var VER = "20260920mob7";
  if (
    global.ErvenowPreRegBanner &&
    String(global.ErvenowPreRegBanner.__ervVer || "") >= VER
  ) {
    return;
  }

  var CSS_ID = "ervPreRegBannerCss";
  var BAR_ID = "ervPreRegBanner";
  var SKIP = /\/admin(\/|$|-)/i;
  var CTA_LABEL = "سجّل";
  var BANNER_COPY = "التسجيل مفتوح — سجّل برقمك.";

  var BANNER_CSS =
    /* Base */
    ".erv-prereg-banner{display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:0.35rem 0.45rem;margin:0;padding:0.4rem max(0.65rem,env(safe-area-inset-left,0px)) 0.4rem max(0.65rem,env(safe-area-inset-right,0px));padding-top:calc(0.4rem + env(safe-area-inset-top,0px));background:#146c43;color:#f4faf7;line-height:1.35;font-size:0.78rem;text-align:center;position:sticky;top:0;z-index:120;flex-shrink:0;font-family:Tajawal,Cairo,system-ui,sans-serif;box-sizing:border-box;}" +
    ".erv-prereg-banner p{margin:0;flex:1 1 auto;text-align:center;max-width:36rem;min-width:0;}" +
    ".erv-prereg-banner__cta{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0.28rem 0.75rem;border-radius:999px;background:#ffffff;color:#0f5a37;font-weight:800;font-size:0.75rem;text-decoration:none;white-space:nowrap;flex:0 0 auto;box-shadow:0 1px 4px rgba(15,40,28,0.12);}" +
    ".erv-prereg-banner__cta:hover{background:#e8f6ef;filter:none;}" +
    /* Header sits under sticky banner */
    "html.erv-has-prereg .lp-header.lp-header--refined," +
    "html.erv-has-prereg .dash-site-header{" +
    "top:var(--erv-prereg-h,0px)!important;}" +
    /* Tablet */
    "@media (min-width:641px) and (max-width:1024px){" +
    ".erv-prereg-banner{font-size:0.76rem;gap:0.35rem 0.5rem;padding-block:0.42rem;padding-top:calc(0.42rem + env(safe-area-inset-top,0px));}" +
    ".erv-prereg-banner__cta{font-size:0.74rem;min-height:38px;}" +
    "}" +
    /* Desktop */
    "@media (min-width:1025px){" +
    ".erv-prereg-banner{font-size:0.82rem;gap:0.45rem 0.55rem;padding:0.5rem max(0.75rem,env(safe-area-inset-left,0px));padding-top:calc(0.5rem + env(safe-area-inset-top,0px));}" +
    ".erv-prereg-banner__cta{font-size:0.76rem;min-height:40px;}" +
    "}" +
    /* Mobile: compact single row — لا يضغط الهيدر */
    "@media (max-width:640px){" +
    ".erv-prereg-banner{flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:6px;padding:6px max(10px,env(safe-area-inset-left,10px)) 6px max(10px,env(safe-area-inset-right,10px));padding-top:calc(6px + env(safe-area-inset-top,0px));font-size:0.7rem;line-height:1.3;}" +
    ".erv-prereg-banner p{flex:1 1 auto;text-align:start;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}" +
    ".erv-prereg-banner__cta{flex:0 0 auto;min-height:34px;min-width:44px;padding:5px 12px;font-size:0.72rem;}" +
    "}" +
    "@media (max-width:360px){" +
    ".erv-prereg-banner{font-size:0.66rem;gap:5px;padding-block:5px;padding-top:calc(5px + env(safe-area-inset-top,0px));}" +
    ".erv-prereg-banner__cta{min-height:32px;padding:4px 10px;font-size:0.7rem;}" +
    "}";

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var el = document.createElement("style");
    el.id = CSS_ID;
    el.textContent = BANNER_CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  function shouldSkip() {
    var path = (global.location && global.location.pathname) || "";
    return SKIP.test(path);
  }

  function measureBanner() {
    var bar = document.getElementById(BAR_ID);
    var root = document.documentElement;
    if (!bar || !root) return;
    var h = Math.ceil(bar.getBoundingClientRect().height) || 0;
    root.style.setProperty("--erv-prereg-h", h + "px");
    root.classList.add("erv-has-prereg");
    /* حدّث ارتفاع الهيدر المحسوب بعد استقرار الشريط */
    try {
      var header = document.querySelector(".lp-header.lp-header--refined, .dash-site-header");
      if (header) {
        var hh = Math.ceil(header.getBoundingClientRect().height);
        if (hh > 0) {
          root.style.setProperty("--erv-mobile-header-h", hh + "px");
          root.style.setProperty("--erw-header-h", hh + "px");
        }
      }
    } catch (e) {}
  }

  function insertBar(bar) {
    var header =
      document.getElementById("top") ||
      document.querySelector(".lp-header") ||
      document.querySelector(".dash-site-header") ||
      document.querySelector("header.dash-site-header") ||
      document.querySelector("header");
    if (header && header.parentNode) {
      header.parentNode.insertBefore(bar, header);
      return;
    }
    if (document.body) document.body.insertBefore(bar, document.body.firstChild);
  }

  function ensureOrder() {
    var bar = document.getElementById(BAR_ID);
    var header =
      document.getElementById("top") ||
      document.querySelector(".lp-header") ||
      document.querySelector(".dash-site-header");
    if (!header || !document.body) return;
    if (bar) {
      if (document.body.firstElementChild !== bar) {
        document.body.insertBefore(bar, document.body.firstElementChild);
      }
      if (bar.nextElementSibling !== header) {
        document.body.insertBefore(header, bar.nextSibling);
      }
    }
  }

  function render() {
    if (document.getElementById(BAR_ID)) {
      ensureCss();
      measureBanner();
      return;
    }
    ensureCss();
    var bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = "erv-prereg-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      "<p>" + BANNER_COPY + "</p>" +
      '<a class="erv-prereg-banner__cta" href="/login?mode=register&amp;role=customer">' +
      CTA_LABEL +
      "</a>";
    insertBar(bar);
    ensureOrder();
    measureBanner();
    watchOrder(4500);
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame(function () {
        ensureOrder();
        measureBanner();
      });
    }
  }

  function boot() {
    if (shouldSkip()) return;
    if (document.getElementById(BAR_ID)) {
      ensureCss();
      /* حدّث نص الزر إن وُجد شريط قديم */
      var cta = document.querySelector("#" + BAR_ID + " .erv-prereg-banner__cta");
      if (cta && /تسجيل مسبق|سجّل/.test(cta.textContent || "")) cta.textContent = CTA_LABEL;
      var p = document.querySelector("#" + BAR_ID + " p");
      if (p && (p.textContent || "").trim() !== BANNER_COPY) {
        p.textContent = BANNER_COPY;
      }
      ensureOrder();
      measureBanner();
      return;
    }
    var api = global.PlatformAPI;
    var url =
      api && typeof api.apiUrl === "function"
        ? api.apiUrl("/api/core/public-config")
        : "/api/core/public-config";
    fetch(url, { credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      })
      .then(function (j) {
        if (!j || j.pre_registration !== true) return;
        render();
      })
      .catch(function () {});
  }

  /* إعادة تثبيت الترتيب بعد سكربتات الجوال التي قد تحرّك الهيدر */
  function watchOrder(ms) {
    var end = Date.now() + (ms || 4000);
    function tick() {
      if (!document.getElementById(BAR_ID)) return;
      ensureOrder();
      measureBanner();
      if (Date.now() < end) global.requestAnimationFrame(tick);
    }
    if (global.requestAnimationFrame) tick();
    [50, 100, 200, 300, 500, 700, 1000, 1400, 2000, 2800, 4000, 6000].forEach(function (t) {
      global.setTimeout(function () {
        if (!document.getElementById(BAR_ID)) return;
        ensureOrder();
        measureBanner();
      }, t);
    });
    try {
      if (document.body && !global.__ervPreRegOrderMo) {
        var moTimer = null;
        global.__ervPreRegOrderMo = new MutationObserver(function () {
          if (moTimer) return;
          moTimer = global.setTimeout(function () {
            moTimer = null;
            ensureOrder();
            measureBanner();
          }, 30);
        });
        global.__ervPreRegOrderMo.observe(document.body, { childList: true });
        global.setTimeout(function () {
          if (global.__ervPreRegOrderMo) {
            global.__ervPreRegOrderMo.disconnect();
            global.__ervPreRegOrderMo = null;
          }
        }, ms || 8000);
      }
    } catch (e) {}
  }

  global.ErvenowPreRegBanner = {
    __ervVer: VER,
    boot: boot,
    render: render,
    measure: measureBanner,
    ensureOrder: ensureOrder,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.addEventListener("resize", function () {
    if (document.getElementById(BAR_ID)) {
      ensureOrder();
      measureBanner();
    }
  });
  global.addEventListener("orientationchange", function () {
    global.setTimeout(function () {
      ensureOrder();
      measureBanner();
    }, 180);
  });

  watchOrder(4500);
})(window);
