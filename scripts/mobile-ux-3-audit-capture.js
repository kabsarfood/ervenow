/**
 * ERVENOW Mobile UX 3.0 — Before screenshots (audit baseline)
 * Usage: node scripts/mobile-ux-3-audit-capture.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "mobile-ux-3.0", "before");

const VIEWPORTS = [
  ["mobile-390", { width: 390, height: 844 }],
  ["tablet-768", { width: 768, height: 1024 }],
  ["desktop-1280", { width: 1280, height: 800 }],
];

const PAGES = [
  { id: "home", url: "/", label: "الرئيسية" },
  { id: "dashboard", url: "/dashboard", label: "لوحة الزائر" },
  { id: "restaurants", url: "/restaurants", label: "المطاعم" },
  { id: "stores", url: "/stores", label: "المتاجر" },
  { id: "services", url: "/services", label: "الخدمات" },
  { id: "delivery-services", url: "/delivery-services.html", label: "التوصيل" },
  { id: "delivery-map", url: "/delivery-map", label: "من الخريطة" },
  { id: "checkout", url: "/checkout", label: "الدفع" },
  { id: "login", url: "/login", label: "تسجيل الدخول" },
  { id: "track", url: "/track", label: "تتبع الحي" },
];

async function measure(page) {
  return page.evaluate(function () {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        visible: r.height > 0 && r.width > 0 && cs.display !== "none" && cs.visibility !== "hidden",
        hidden: el.hidden === true,
      };
    }
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button, .btn, a.lp-btn-solid, a.sn-hero__cta, .dash-site-header__btn"));
    var smallTouch = 0;
    buttons.slice(0, 80).forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 44) smallTouch++;
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docH: document.documentElement.scrollHeight,
      header: rect("header, .lp-header, .dash-site-header"),
      mainBanner: rect("#homeMainBanner, #guestOffersCarousel, #ervRestaurantsBanner, #ervStoresBanner, #ervServicesBanner, #ervDeliveryBanner"),
      search: rect(".stores-search, input[type='search'], #dsServiceChips"),
      footer: rect("footer, .dash-site-footer, .lp-footer"),
      smallTouchTargets: smallTouch,
      buttonSample: buttons.length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
}

async function capturePage(browser, cfg, vpName, viewport) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  const t0 = Date.now();
  try {
    await page.goto(BASE + cfg.url, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    await page.goto(BASE + cfg.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(function () {});
  }
  await page.waitForTimeout(2200);
  const metrics = await measure(page);
  const file = cfg.id + "-" + vpName + ".png";
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  const fileFull = cfg.id + "-" + vpName + "-full.png";
  await page.screenshot({ path: path.join(OUT, fileFull), fullPage: true });
  await page.close();
  return {
    page: cfg.id,
    label: cfg.label,
    viewport: vpName,
    loadMs: Date.now() - t0,
    screenshot: "docs/screenshots/mobile-ux-3.0/before/" + file,
    screenshotFull: "docs/screenshots/mobile-ux-3.0/before/" + fileFull,
    metrics,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = {
    capturedAt: new Date().toISOString(),
    phase: "before",
    baseUrl: BASE,
    viewports: VIEWPORTS.map(function (v) {
      return { name: v[0], size: v[1] };
    }),
    pages: PAGES.map(function (p) {
      return { id: p.id, label: p.label, url: p.url };
    }),
    measurements: [],
  };

  for (const cfg of PAGES) {
    for (const [name, vp] of VIEWPORTS) {
      process.stdout.write("capture " + cfg.id + " " + name + "...\n");
      report.measurements.push(await capturePage(browser, cfg, name, vp));
    }
  }

  await browser.close();
  const jsonPath = path.join(__dirname, "..", "docs", "screenshots", "mobile-ux-3.0", "before-audit.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log("Wrote", jsonPath);
  console.log("Screenshots in", OUT);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
