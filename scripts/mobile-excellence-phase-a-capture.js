/**
 * ERVENOW Mobile Excellence Phase A — After screenshots + metrics
 * Usage: node scripts/mobile-excellence-phase-a-capture.js [before|after]
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
  phase === "before" ? "before" : "after"
);

const VIEWPORT = { width: 390, height: 844 };

const PAGES = [
  { id: "home", url: "/" },
  { id: "dashboard", url: "/dashboard" },
  { id: "restaurants", url: "/restaurants" },
  { id: "stores", url: "/stores" },
  { id: "services", url: "/services" },
  { id: "delivery", url: "/delivery-services.html" },
  { id: "checkout", url: "/checkout" },
  { id: "my-orders", url: "/my-orders" },
  { id: "login", url: "/login" },
];

async function measure(page) {
  return page.evaluate(function () {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return {
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        visible: r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
      };
    }
    var hub = document.querySelector(".sn-home-hub--direct, .dash-tabs-card");
    var hubRect = hub ? hub.getBoundingClientRect() : null;
    return {
      headerLp: rect(".lp-header.lp-header--refined"),
      headerDash: rect(".dash-site-header"),
      bottomNav: rect(".erv-mobile-bottom-nav"),
      banner: rect("#homeMainBanner, #guestOffersCarousel"),
      hubTop: hubRect ? Math.round(hubRect.top) : null,
      hubVisible: hubRect ? hubRect.top < window.innerHeight : false,
      foundation: document.body.classList.contains("erv-mobile-foundation"),
      cssHeaderH: getComputedStyle(document.documentElement).getPropertyValue("--erv-mobile-header-h").trim(),
    };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const cfg of PAGES) {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    try {
      await page.goto(BASE + cfg.url, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) {
      await page.goto(BASE + cfg.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    }
    await page.waitForTimeout(2500);
    const metrics = await measure(page);
    const file = cfg.id + "-mobile-390.png";
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    results.push({ id: cfg.id, url: cfg.url, file, metrics });
    await page.close();
    console.log(cfg.id, metrics);
  }

  await browser.close();
  const jsonPath = path.join(OUT, "metrics.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ phase, capturedAt: new Date().toISOString(), results }, null, 2));
  console.log("Saved", jsonPath);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
