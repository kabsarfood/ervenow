/**
 * Phase A Final — CLS/LCP/FCP + screenshots
 * node scripts/mobile-excellence-phase-a-final-verify.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "mobile-excellence", "final");
const VIEWPORT = { width: 390, height: 844 };

const PAGES = [
  { id: "home", url: "/" },
  { id: "checkout", url: "/checkout" },
  { id: "dashboard", url: "/dashboard" },
];

async function measureWebVitals(page) {
  return page.evaluate(function () {
    return new Promise(function (resolve) {
      var out = { lcp: null, cls: 0, fcp: null, loadEventEnd: null, domContentLoaded: null, lcpElement: null };
      try {
        var nav = performance.getEntriesByType("navigation")[0];
        if (nav) {
          out.loadEventEnd = Math.round(nav.loadEventEnd);
          out.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
        }
        performance.getEntriesByType("paint").forEach(function (p) {
          if (p.name === "first-contentful-paint") out.fcp = Math.round(p.startTime);
        });
        var lcpEntries = performance.getEntriesByType("largest-contentful-paint");
        if (lcpEntries.length) {
          var last = lcpEntries[lcpEntries.length - 1];
          out.lcp = Math.round(last.startTime);
          if (last.element) {
            out.lcpElement =
              last.element.tagName +
              (last.element.id ? "#" + last.element.id : "") +
              (last.element.className ? "." + String(last.element.className).split(" ")[0] : "");
          }
        }
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
        }, 2000);
      } catch (e2) {
        resolve(out);
      }
      try {
        var lcpObs = new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          if (entries.length) {
            var last = entries[entries.length - 1];
            out.lcp = Math.round(last.startTime);
            if (last.element) {
              out.lcpElement =
                last.element.tagName +
                (last.element.id ? "#" + last.element.id : "") +
                (last.element.className ? "." + String(last.element.className).split(" ")[0] : "");
            }
          }
        });
        lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      } catch (e3) {}
    });
  });
}

async function measureHub(page) {
  return page.evaluate(function () {
    var nav = document.querySelector(".erv-mobile-bottom-nav");
    var navH = nav && nav.offsetParent !== null ? nav.getBoundingClientRect().height : 0;
    var safeBottom = window.innerHeight - navH;
    var cards = {};
    document.querySelectorAll(".sn-home-hub--direct .sn-card").forEach(function (card) {
      var name = ((card.querySelector(".sn-card__name") || {}).textContent || "").trim();
      var r = card.getBoundingClientRect();
      var visibleH = Math.max(0, Math.min(r.bottom, safeBottom) - Math.max(r.top, 0));
      cards[name] = { visiblePct: r.height > 0 ? Math.round((visibleH / r.height) * 100) : 0 };
    });
    return {
      shell: document.documentElement.classList.contains("erv-mobile-shell"),
      noNav: document.documentElement.classList.contains("erv-mobile-no-nav"),
      headerH: (function () {
        var h = document.querySelector(".lp-header, .dash-site-header");
        return h ? Math.round(h.getBoundingClientRect().height) : null;
      })(),
      bottomNavVisible: !!(nav && nav.classList.contains("erv-mobile-bottom-nav--ready")),
      cards: cards,
    };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { capturedAt: new Date().toISOString(), viewport: VIEWPORT, pages: [] };

  for (const cfg of PAGES) {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    try {
      await page.goto(BASE + cfg.url, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) {
      await page.goto(BASE + cfg.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    }
    await page.waitForTimeout(3000);
    const vitals = await measureWebVitals(page);
    const extra = cfg.id === "home" ? await measureHub(page) : await page.evaluate(function () {
      return {
        shell: document.documentElement.classList.contains("erv-mobile-shell"),
        noNav: document.documentElement.classList.contains("erv-mobile-no-nav"),
        bottomNav: !!document.querySelector(".erv-mobile-bottom-nav--ready"),
      };
    });
    const file = cfg.id + "-mobile-390-final.png";
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    report.pages.push({ id: cfg.id, url: cfg.url, file, vitals, extra });
    await page.close();
    console.log(cfg.id, vitals, extra);
  }

  await browser.close();
  const jsonPath = path.join(OUT, "metrics-final.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log("Saved", jsonPath);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
