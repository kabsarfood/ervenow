/**
 * Mobile Harmony P0 — header audit (390px)
 * node scripts/mobile-harmony-audit.js [after]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const phase = (process.argv[2] || "after").toLowerCase();
const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(
  __dirname,
  "..",
  "docs",
  "screenshots",
  "mobile-excellence",
  phase === "before" ? "harmony-p0-before" : "harmony-p0-after"
);
const VIEWPORT = { width: 390, height: 844 };

const PAGES = [
  { id: "home", url: "/", label: "الرئيسية" },
  { id: "start-now", url: "/start-now", label: "ابدأ الآن" },
  { id: "restaurants", url: "/restaurants", label: "المطاعم" },
];

async function measureHeader(page, pageId) {
  return page.evaluate(function (pid) {
    function vis(sel) {
      var el = document.querySelector(sel);
      if (!el) return { found: false };
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var hidden =
        cs.display === "none" ||
        cs.visibility === "hidden" ||
        r.width <= 0 ||
        r.height <= 0 ||
        cs.opacity === "0" ||
        cs.pointerEvents === "none" && cs.position === "absolute";
      return {
        found: true,
        visible: !hidden && r.width > 0 && r.height > 0,
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }
    return {
      headerCart: vis(".lp-draft-checkout-badge, .dash-header-cart"),
      bottomNavCartBadge: vis("#ervMobileNavCartBadge"),
      bottomNavCartItem: vis('.erv-mobile-bottom-nav__item[data-erv-nav="cart"]'),
      cartCountEl: !!document.getElementById("cartCount"),
      cartCountText: document.getElementById("cartCount")
        ? document.getElementById("cartCount").textContent.trim()
        : null,
      menuBtn: vis(".lp-quick-dd__btn, .erv-harmony-menu__btn"),
      identity: vis(".lp-header__brand-mid, .erv-harmony-identity"),
      logo: vis(".lp-header__logo-slot, .dash-site-header__logo"),
      headerH: document.querySelector(".lp-header, .dash-site-header")
        ? Math.round(document.querySelector(".lp-header, .dash-site-header").getBoundingClientRect().height)
        : null,
      pageId: pid,
    };
  }, pageId);
}

async function capture(browser, cfg) {
  const page = await browser.newPage();
  await page.setViewportSize(VIEWPORT);
  const bust = Date.now();
  await page
    .goto(BASE + cfg.url + (cfg.url.indexOf("?") >= 0 ? "&" : "?") + "ervHarmony=" + bust, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    })
    .catch(function () {});
  await page.waitForTimeout(2200);
  const metrics = await measureHeader(page, cfg.id);
  const file = cfg.id + "-header-390.png";
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  await page.close();
  return { ...cfg, metrics, screenshot: file };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const cfg of PAGES) {
    results.push(await capture(browser, cfg));
  }
  await browser.close();
  const report = {
    capturedAt: new Date().toISOString(),
    phase,
    viewport: VIEWPORT,
    results,
  };
  fs.writeFileSync(path.join(OUT, "audit-metrics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
