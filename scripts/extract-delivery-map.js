/**
 * One-off: extract map form + JS + CSS from dashboard.html
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dashPath = path.join(root, "ervenow-frontend", "dashboard.html");
if (!fs.existsSync(dashPath)) {
  throw new Error("Source dashboard not found at " + dashPath);
}
const html = fs.readFileSync(dashPath, "utf8");

const detailsStart = html.indexOf('<details class="cat-card cat-card--map"');
const panelStart = html.indexOf('<div class="delivery-panel delivery-panel--luxe"', detailsStart);
const panelEndMarker = '<input type="hidden" id="mapCustomerPhone"';
const panelEnd = html.indexOf(panelEndMarker, panelStart);
if (detailsStart < 0 || panelStart < 0 || panelEnd < 0) throw new Error("map panel block not found");
const detailsEnd = html.indexOf("</details>", panelEnd) + "</details>".length;

let formBlock = html.slice(detailsStart, detailsEnd);
formBlock = formBlock.replace(
  /<details class="cat-card cat-card--map"[^>]*>[\s\S]*?<\/summary>\s*/,
  ""
);
formBlock = formBlock.replace(/<\/details>\s*$/, "");
formBlock = formBlock.replace(
  /<button type="button" class="delivery-panel__close" id="dashMapCloseBtn" aria-label="إغلاق">×<\/button>/,
  '<a class="delivery-panel__back" href="/dashboard" aria-label="العودة إلى لوحة الزائر">← رجوع</a>'
);

const scriptStart = html.indexOf("      var km = 0;");
const scriptEnd = html.indexOf("      function roleLabelAr(role)", scriptStart);
if (scriptStart < 0 || scriptEnd < 0) throw new Error("script block not found");

let js = html.slice(scriptStart, scriptEnd);
js = js.replace(/function dashHasToken\(\)[\s\S]*?}\s*\n\s*function setActiveServiceCard[\s\S]*?}\s*\n\s*/m, "");
js = js.replace(/dashHasToken/g, "mapPageHasToken");
js = js.replace(/resolveDashCustomerPhone/g, "resolveMapPageCustomerPhone");
js = js.replace(/source: "dashboard_map"/g, 'source: "delivery_map_page"');
js = js.replace(
  /var details = document\.getElementById\("dashDeliveryTitle"\);[\s\S]*?observer\.observe\(actionsEl\);\s*}/,
  `var pageRoot = document.querySelector(".delivery-map-page__shell");
        if (!pageRoot) return;
        mapResizeObserverBound = true;
        var timer = null;
        var observer = new ResizeObserver(function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            refreshMapSize(true);
          }, 60);
        });
        observer.observe(mapEl);
        if (mapCell) observer.observe(mapCell);
        if (actionsEl) observer.observe(actionsEl);
        observer.observe(pageRoot);`
);
js = js.replace(
  /var panel = el\.closest\("\.delivery-panel__body"\);/,
  'var panel = document.querySelector(".delivery-map-page__scroll");'
);

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error("style not found");
let css = styleMatch[1];

function stripModalCss(input) {
  const lines = input.split("\n");
  const out = [];
  for (const line of lines) {
    if (/dash-map-modal-open|dash-map-backdrop|dashMapModalIn|cat-card--map|dashDeliveryTitle/.test(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

css = stripModalCss(css);
const cssChunks = [];
const markers = [
  "/* ── Canva: شبكة 2×2 — من الخريطة ── */",
  ".delivery-live-map-link",
  ".delivery-panel--luxe",
  ".delivery-panel__header",
  "#pickupDropMap.map-selecting",
];
let collecting = false;
const cssLines = css.split("\n");
for (let i = 0; i < cssLines.length; i++) {
  const line = cssLines[i];
  if (line.includes("/* ── Canva: شبكة 2×2")) collecting = true;
  if (collecting) cssChunks.push(line);
  if (collecting && line.includes(".delivery-dropdown {")) break;
}
let mapCss = cssChunks.join("\n");
mapCss = mapCss.replace(/body\.dash-map-modal-open[^\n]*\n/g, "");
mapCss = mapCss.replace(/      body\.dash-map-modal-open[^\n]*\n/g, "");

const pageCss = `/* ERVENOW — صفحة طلب التوصيل من الخريطة (Mobile First) */
:root {
  --delivery-map-h: clamp(280px, 52vh, 520px);
}
body.delivery-map-page {
  background: #f3ebe0;
}
.delivery-map-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
.delivery-map-page__shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: calc(var(--erw-viewport-h, 100dvh) - var(--erw-header-h, 120px));
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  background: linear-gradient(168deg, #fffefb 0%, #faf4eb 38%, #f3e8d8 100%);
  border-radius: 0;
  overflow: hidden;
}
@media (min-width: 768px) {
  .delivery-map-main {
    padding: 12px 16px 20px;
  }
  .delivery-map-page__shell {
    border-radius: 22px;
    border: 1px solid rgba(212, 168, 74, 0.38);
    box-shadow: 0 16px 48px rgba(45, 26, 14, 0.12);
    min-height: calc(var(--erw-viewport-h, 100dvh) - var(--erw-header-h, 120px) - 32px);
  }
}
.delivery-map-page__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.delivery-panel__back {
  position: absolute;
  inset-inline-start: 12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #fffef8;
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 800;
  text-decoration: none;
}
.delivery-panel__back:hover {
  background: rgba(255, 255, 255, 0.22);
}
.delivery-map-page .delivery-panel__body {
  padding: clamp(10px, 2vw, 14px);
}
.delivery-map-page .map-canvas-cell--map #pickupDropMap,
.delivery-map-page .map-canvas-cell--map #pickupDropMap.leaflet-container {
  height: var(--delivery-map-h) !important;
  min-height: var(--delivery-map-h) !important;
  flex: 1 1 auto;
  max-height: none !important;
}
@media (min-width: 768px) {
  :root {
    --delivery-map-h: clamp(360px, 58vh, 560px);
  }
  .delivery-map-page .map-canvas-grid {
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 0.5fr);
    grid-template-areas:
      "map method"
      "map shipment"
      "map actions";
  }
}
@media (min-width: 1024px) {
  .delivery-map-page .map-canvas-grid {
    grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.45fr);
  }
}
${mapCss}
`;

const pageJs = `/**
 * ERVENOW — صفحة طلب التوصيل من الخريطة (/delivery-map)
 */
(function (global) {
  "use strict";

  function mapPageHasToken() {
    try {
      return !!(global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken());
    } catch (e) {
      return false;
    }
  }

${js}

  function bootDeliveryMapPage() {
    if (global.ErvenowGuestShell && ErvenowGuestShell.refreshAuthHeader) {
      ErvenowGuestShell.refreshAuthHeader();
    }
    if (typeof global.updateCartCount === "function") global.updateCartCount();
    setDeliveryMode("map");
    updateApplyBtnLabel();
    initMap();
    bindMapResizeObserver();
    refreshMapSize(true);
    setTimeout(function () {
      refreshMapSize(true);
    }, 200);
    global.addEventListener("resize", function () {
      refreshMapSize(true);
    });
    global.addEventListener("storage", function (ev) {
      if (ev.key === "cart" && typeof global.updateCartCount === "function") {
        global.updateCartCount();
      }
    });
    global.addEventListener("ervenow-api-retry", function (ev) {
      var d = ev.detail || {};
      var btn = document.getElementById("createBtn");
      var result = document.getElementById("result");
      if (!btn || !btn.disabled || !result) return;
      if (String(d.path || "").indexOf("/api/delivery/orders") === -1) return;
      result.innerText =
        "جارٍ إنشاء الطلب… (إعادة محاولة " + d.attempt + " من " + d.maxAttempts + ")";
    });
    global.addEventListener("ervenow-offline-queued", function () {
      var result = document.getElementById("result");
      if (result) {
        result.innerText =
          "⚠ لا يوجد اتصال: اُحتفظ بالطلب محلياً وسيُرسل تلقائياً عند عودة الشبكة.";
      }
    });
  }

  global.setDeliveryMode = setDeliveryMode;
  global.applyMapRoute = applyMapRoute;
  global.createOrder = createOrder;
  global.selectMode = selectMode;
  global.recalculatePricePreview = recalculatePricePreview;
  global.handleLocationInputChange = handleLocationInputChange;
  global.scrollToMapRoutes = scrollToMapRoutes;
  global.syncMapCustomerPhone = syncMapCustomerPhone;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootDeliveryMapPage);
  } else {
    bootDeliveryMapPage();
  }
})(typeof window !== "undefined" ? window : global);
`;

const pageHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="description" content="حدّد مسار التوصيل على الخريطة أو عبر روابط Google Maps — احسب المسافة والسعر وأضف الطلب للسلة." />
    <script src="/assets/viewport-fit.js"></script>
    <title>ERVENOW | طلب توصيل من الخريطة</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/styles.css" />
    <link rel="stylesheet" href="/assets/guest-shell.css" />
    <link rel="stylesheet" href="/assets/delivery-map-page.css" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  </head>
  <body class="guest-shell-page delivery-map-page">
    <header class="dash-site-header">
      <div class="dash-site-header__inner">
        <div class="dash-site-header__brand">
          <a class="dash-site-header__logo" href="/">ERVENOW<span class="dash-site-header__logo-dot" aria-hidden="true"></span></a>
          <p class="dash-site-header__tag" id="guestShellPageTag">طلب من الخريطة</p>
        </div>
        <nav class="dash-site-header__nav" aria-label="التنقل الرئيسي">
          <div class="dash-site-header__links">
            <a class="dash-site-header__link" href="/" data-nav="home">الرئيسية</a>
            <a class="dash-site-header__link" href="/dashboard" data-nav="guest">لوحة الزائر</a>
            <a class="dash-site-header__link" href="/track" data-nav="track">تتبع الحي</a>
            <a class="dash-site-header__link dash-site-header__link--cta" href="/login?role=customer" data-nav="login">دخول</a>
          </div>
        </nav>
        <div class="dash-site-header__tools">
          <a class="dash-header-wallet" id="dashHeaderWallet" href="/wallet.html" hidden aria-label="المحفظة">
            <span class="dash-header-wallet__label">محفظة</span>
            <span class="dash-header-wallet__val" id="dashHeaderWalletAmount">—</span>
            <span class="dash-header-wallet__cur">ر.س</span>
          </a>
          <a class="dash-header-cart" href="/cart" aria-label="السلة — الدفع">
            <span aria-hidden="true">🛒</span>
            <span class="dash-header-cart__label">السلة</span>
            <span class="dash-header-cart__badge" id="cartCount" data-empty="true">0</span>
          </a>
        </div>
        <a class="dash-site-header__btn dash-site-header__btn--primary switch-account--nav-only" href="/login?role=customer" id="switchAccount">تسجيل الدخول</a>
      </div>
    </header>

    <main class="delivery-map-main" id="deliveryMapMain">
      <div class="delivery-map-page__shell">
${formBlock
  .split("\n")
  .map((l) => "        " + l)
  .join("\n")
  .replace(/delivery-panel__body/g, "delivery-panel__body delivery-map-page__scroll")}
      </div>
    </main>

    <script src="/assets/cart.js"></script>
    <script src="/assets/service-cart.js"></script>
    <script src="/assets/delivery-map-order.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="/assets/api-config.js"></script>
    <script src="/assets/api.js"></script>
    <script src="/assets/auth-account-guard.js"></script>
    <script src="/assets/guestBrowse.js"></script>
    <script src="/assets/guest-shell.js"></script>
    <script src="/assets/delivery-map-page.js"></script>
    <script>
      ErvenowGuestShell.init({ activeNav: "guest", pageTag: "طلب من الخريطة" });
      (function () {
        if (!window.PlatformAPI || !window.PlatformAPI.getToken()) return;
        void ErvenowAuthGuard.ensureApprovedAccount();
      })();
    </script>
  </body>
</html>
`;

fs.writeFileSync(path.join(root, "public", "assets", "delivery-map-page.js"), pageJs);
fs.writeFileSync(path.join(root, "public", "assets", "delivery-map-page.css"), pageCss);
fs.writeFileSync(path.join(root, "public", "delivery-map.html"), pageHtml);
console.log("Wrote delivery-map.html, delivery-map-page.js, delivery-map-page.css");
