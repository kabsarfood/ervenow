/**
 * ERVENOW — شريط التسجيل المسبق (أسلوب صفحة تسجيل المتجر) على كامل المنصة
 */
(function (global) {
  if (global.ErvenowPreRegBanner) return;

  var CSS_ID = "ervPreRegBannerCss";
  var BAR_ID = "ervPreRegBanner";
  var SKIP = /\/admin(\/|$|-)/i;

  var BANNER_CSS =
    ".erv-prereg-banner{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:0.38rem 0.5rem;margin:0;padding:0.55rem max(0.75rem,env(safe-area-inset-left,0px)) 0.55rem max(0.75rem,env(safe-area-inset-right,0px));background:#3d2213;color:#f8f4ee;line-height:1.5;font-size:0.82rem;text-align:center;position:relative;z-index:90;flex-shrink:0;font-family:Cairo,system-ui,sans-serif;}" +
    ".erv-prereg-banner p{margin:0;flex:0 1 auto;text-align:center;max-width:42rem;}" +
    ".erv-prereg-banner__cta{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0.35rem 0.9rem;border-radius:999px;background:#f4c430;color:#3d2213;font-weight:800;font-size:0.78rem;text-decoration:none;white-space:nowrap;flex:0 0 auto;}" +
    ".erv-prereg-banner__cta:hover{filter:brightness(1.04);}" +
    "@media (min-width:641px) and (max-width:1024px){.erv-prereg-banner{font-size:0.78rem;gap:0.4rem 0.55rem;}.erv-prereg-banner__cta{font-size:0.76rem;min-height:40px;}}" +
    "@media (min-width:1025px){.erv-prereg-banner{font-size:0.84rem;gap:0.5rem;}.erv-prereg-banner__cta{font-size:0.78rem;min-height:40px;}}" +
    "@media (max-width:640px){.erv-prereg-banner{flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px max(14px,env(safe-area-inset-left,14px)) 10px max(14px,env(safe-area-inset-right,14px));font-size:0.72rem;line-height:1.5;}.erv-prereg-banner p{flex:none;text-align:center;}.erv-prereg-banner__cta{width:auto;align-self:center;min-height:40px;padding:6px 14px;font-size:0.72rem;}}" +
    "@media (min-width:361px) and (max-width:640px){.erv-prereg-banner{flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px 6px;font-size:0.74rem;}.erv-prereg-banner p{flex:0 1 auto;min-width:0;}.erv-prereg-banner__cta{flex:0 0 auto;font-size:0.72rem;}}" +
    "@media (max-width:360px){.erv-prereg-banner{font-size:0.7rem;padding-block:9px;}}";

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

  function insertBar(bar) {
    var header =
      document.querySelector(".dash-site-header") ||
      document.querySelector(".lp-header") ||
      document.querySelector("header.dash-site-header") ||
      document.querySelector("header");
    if (header && header.parentNode) {
      header.parentNode.insertBefore(bar, header.nextSibling);
      return;
    }
    if (document.body) document.body.insertBefore(bar, document.body.firstChild);
  }

  function render() {
    if (document.getElementById(BAR_ID)) return;
    ensureCss();
    var bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = "erv-prereg-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      "<p>التسجيل مفتوح الآن — الطلبات التجارية لم تُطلق بعد. سجّل برقمك وسنبلغك عند بدء الخدمة.</p>" +
      '<a class="erv-prereg-banner__cta" href="/login?mode=register&amp;role=customer">تسجيل مسبق</a>';
    insertBar(bar);
  }

  function boot() {
    if (shouldSkip()) return;
    if (document.getElementById(BAR_ID)) {
      ensureCss();
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

  global.ErvenowPreRegBanner = { boot: boot, render: render };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
