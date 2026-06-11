/**
 * Phase A — After Review verification (390px)
 * node scripts/mobile-excellence-phase-a-verify.js
 */
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "mobile-excellence", "after-review");
const VIEWPORT = { width: 390, height: 844 };

const HUB_KEYS = ["restaurants", "stores", "delivery", "services"];

async function waitReady(page) {
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  }
  await page.waitForTimeout(2800);
}

async function measureHubFirstScreen(page) {
  return page.evaluate(function (keys) {
    var vh = window.innerHeight;
    var nav = document.querySelector(".erv-mobile-bottom-nav");
    var navH = nav ? nav.getBoundingClientRect().height : 0;
    var safeBottom = vh - navH;
    var cards = document.querySelectorAll(".sn-home-hub--direct .sn-card");
    var byName = {};
    cards.forEach(function (card) {
      var name = (card.querySelector(".sn-card__name") || {}).textContent || "";
      var r = card.getBoundingClientRect();
      var visibleH = Math.max(0, Math.min(r.bottom, safeBottom) - Math.max(r.top, 0));
      var pct = r.height > 0 ? Math.round((visibleH / r.height) * 100) : 0;
      byName[name.trim()] = {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        visiblePct: pct,
        fullyVisible: pct >= 95 && r.top >= 0 && r.bottom <= safeBottom + 2,
      };
    });
    var scrollNeeded = 0;
    cards.forEach(function (card) {
      var r = card.getBoundingClientRect();
      if (r.bottom > safeBottom) scrollNeeded = Math.max(scrollNeeded, Math.ceil(r.bottom - safeBottom));
    });
    return {
      viewport: { w: window.innerWidth, h: vh },
      safeBottom: Math.round(safeBottom),
      headerH: (function () {
        var h = document.querySelector(".lp-header");
        return h ? Math.round(h.getBoundingClientRect().height) : null;
      })(),
      cards: byName,
      scrollPxToSeeAllHub: scrollNeeded,
      allFourMostlyVisible: scrollNeeded <= 40,
    };
  }, HUB_KEYS);
}

async function measureWebVitals(page) {
  return page.evaluate(function () {
    return new Promise(function (resolve) {
      var out = { lcp: null, cls: 0, fcp: null, loadEventEnd: null, domContentLoaded: null };
      try {
        var nav = performance.getEntriesByType("navigation")[0];
        if (nav) {
          out.loadEventEnd = Math.round(nav.loadEventEnd);
          out.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
        }
        var paints = performance.getEntriesByType("paint");
        paints.forEach(function (p) {
          if (p.name === "first-contentful-paint") out.fcp = Math.round(p.startTime);
        });
      } catch (e) {}
      var cls = 0;
      try {
        var po = new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (e) {
            if (!e.hadRecentInput) cls += e.value;
          });
        });
        po.observe({ type: "layout-shift", buffered: true });
        setTimeout(function () {
          po.disconnect();
          out.cls = Math.round(cls * 1000) / 1000;
          resolve(out);
        }, 1200);
      } catch (e2) {
        resolve(out);
      }
      try {
        var lcpObs = new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          if (entries.length) {
            var last = entries[entries.length - 1];
            out.lcp = Math.round(last.startTime);
            out.lcpElement = last.element
              ? last.element.tagName + (last.element.id ? "#" + last.element.id : "") + (last.element.className ? "." + String(last.element.className).split(" ")[0] : "")
              : null;
          }
        });
        lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      } catch (e3) {}
    });
  });
}

async function measureWebVitalsWithoutFoundation(page) {
  await page.route("**/mobile-foundation.css", (route) => route.abort());
  await page.route("**/mobile-foundation.js", (route) => route.abort());
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  }
  await page.waitForTimeout(2800);
  return measureWebVitals(page);
}

async function testBottomNavConflicts(browser) {
  const checks = [];

  async function check(id, url, fn) {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    try {
      await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) {
      await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    }
    await page.waitForTimeout(2000);
    const result = await fn(page);
    const file = id + "-nav-check.png";
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    checks.push({ id, url, file, ...result });
    await page.close();
  }

  await check("checkout", "/checkout", async (page) => {
    return page.evaluate(function () {
      var nav = document.querySelector(".erv-mobile-bottom-nav");
      var navR = nav ? nav.getBoundingClientRect() : null;
      var blockers = [];
      ["button", "a", "input", ".checkout", "[class*='cta']", "[class*='submit']"].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.height < 36 || r.width < 36) return;
          if (!navR) return;
          if (r.bottom > navR.top + 4 && r.top < navR.bottom) {
            var t = (el.textContent || "").trim().slice(0, 40);
            if (t) blockers.push({ text: t, bottom: Math.round(r.bottom), navTop: Math.round(navR.top) });
          }
        });
      });
      return {
        navVisible: !!nav,
        navTop: navR ? Math.round(navR.top) : null,
        overlapCount: blockers.length,
        overlaps: blockers.slice(0, 5),
        conflict: blockers.length > 0,
      };
    });
  });

  await check("delivery-map", "/delivery-map", async (page) => {
    return page.evaluate(function () {
      var nav = document.querySelector(".erv-mobile-bottom-nav");
      var map = document.querySelector("#deliveryMap, .leaflet-container, #map");
      var navR = nav ? nav.getBoundingClientRect() : null;
      var mapR = map ? map.getBoundingClientRect() : null;
      return {
        navVisible: !!nav,
        mapVisible: !!mapR && mapR.height > 50,
        mapBottom: mapR ? Math.round(mapR.bottom) : null,
        navTop: navR ? Math.round(navR.top) : null,
        mapObscuredByNav: mapR && navR ? mapR.bottom > navR.top && mapR.bottom <= window.innerHeight : false,
        conflict: mapR && navR ? mapR.bottom > navR.top + 20 : false,
      };
    });
  });

  await check("live-map", "/live-map", async (page) => {
    return page.evaluate(function () {
      var nav = document.querySelector(".erv-mobile-bottom-nav");
      var map = document.querySelector(".leaflet-container, #map, canvas");
      var navR = nav ? nav.getBoundingClientRect() : null;
      var mapR = map ? map.getBoundingClientRect() : null;
      return {
        navVisible: !!nav,
        mapBottom: mapR ? Math.round(mapR.bottom) : null,
        navTop: navR ? Math.round(navR.top) : null,
        conflict: mapR && navR ? mapR.bottom > navR.top + 20 : false,
      };
    });
  });

  await check("login-keyboard", "/login", async (page) => {
    var input = page.locator("input[type='tel'], input[type='text'], input").first();
    if (await input.count()) {
      await input.click();
      await page.waitForTimeout(400);
    }
    return page.evaluate(function () {
      var nav = document.querySelector(".erv-mobile-bottom-nav");
      var navR = nav ? nav.getBoundingClientRect() : null;
      var focused = document.activeElement;
      var focusR = focused && focused.getBoundingClientRect ? focused.getBoundingClientRect() : null;
      var navCoversInput =
        navR && focusR
          ? focusR.bottom > navR.top - 8 && focusR.top < navR.bottom
          : false;
      return {
        navVisible: !!nav,
        focusedTag: focused ? focused.tagName : null,
        focusBottom: focusR ? Math.round(focusR.bottom) : null,
        navTop: navR ? Math.round(navR.top) : null,
        conflict: navCoversInput,
        note: "محاكاة تركيز الحقل — لوحة المفاتيح الافتراضية غير مفعّلة في Playwright",
      };
    });
  });

  await check("restaurants-modal", "/restaurants", async (page) => {
    return page.evaluate(function () {
      var nav = document.querySelector(".erv-mobile-bottom-nav");
      var modals = document.querySelectorAll("[role='dialog'], .modal, .overlay, [class*='modal']");
      return {
        navVisible: !!nav,
        modalCount: modals.length,
        conflict: false,
        note: "لا نافذة منبثقة مفتوحة افتراضياً",
      };
    });
  });

  return checks;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { capturedAt: new Date().toISOString(), viewport: VIEWPORT };

  const page = await browser.newPage();
  await page.setViewportSize(VIEWPORT);
  await waitReady(page);

  const hub = await measureHubFirstScreen(page);
  report.hubFirstScreen = hub;

  await page.screenshot({
    path: path.join(OUT, "home-first-screen-390.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: path.join(OUT, "home-first-screen-390-full.png"),
    fullPage: true,
  });

  report.performanceAfter = await measureWebVitals(page);

  const pageBefore = await browser.newPage();
  await pageBefore.setViewportSize(VIEWPORT);
  report.performanceBeforeApprox = await measureWebVitalsWithoutFoundation(pageBefore);
  await pageBefore.close();
  await page.close();

  report.bottomNavChecks = await testBottomNavConflicts(browser);
  await browser.close();

  const jsonPath = path.join(OUT, "verification.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("Saved", jsonPath);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
