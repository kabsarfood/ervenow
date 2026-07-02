/**
 * P1-C Home Validation — mobile @390 + desktop @1280
 * node scripts/p1c-home-validation.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "p1c-validation");

function measure(page, vh) {
  return page.evaluate(function (viewportH) {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      var r = el.getBoundingClientRect();
      if (r.height <= 0) return null;
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        h: Math.round(r.height),
        inFold: r.top < viewportH && r.bottom > 0,
      };
    }

    function wordsInFold() {
      var useful = [];
      var noise = [];
      var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walk.nextNode())) {
        var t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        var el = node.parentElement;
        if (!el || el.closest(".erv-mobile-bottom-nav")) continue;
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (el.closest("[aria-hidden='true']")) continue;
        var r = el.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= viewportH) continue;
        var parts = t.split(/\s+/).filter(Boolean);
        var inCard = !!el.closest("#snHomeHub .sn-card__name");
        var inTrust = !!el.closest(".sn-trust__item");
        parts.forEach(function (w) {
          if (inCard || inTrust) useful.push(w);
          else noise.push(w);
        });
      }
      return { useful: useful.length, noise: noise.length };
    }

    var why = rect("#why");
    var firstCard = rect("#snHomeHub .sn-card");
    var trust = rect(".sn-trust");
    var main = rect("main");
    var banner = rect("#homeMainBanner:not([hidden])");
    var cardsInFold = 0;
    document.querySelectorAll("#snHomeHub .sn-card").forEach(function (c) {
      var r = c.getBoundingClientRect();
      if (r.top < viewportH && r.bottom > 0) cardsInFold++;
    });
    var w = wordsInFold();

    return {
      viewport: { w: innerWidth, h: viewportH },
      firstCardTop: firstCard ? firstCard.top : null,
      trustBottom: trust ? trust.bottom : null,
      whyInFold: why ? why.inFold : false,
      whyTop: why ? why.top : null,
      mainInFold: main ? main.inFold : false,
      cardsInFold,
      bannerInFold: banner ? banner.inFold : false,
      bannerHidden: document.getElementById("homeMainBanner")?.hasAttribute("hidden"),
      words: w,
    };
  }, vh);
}

async function main() {
  const browser = await chromium.launch();
  fs.mkdirSync(OUT, { recursive: true });

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobilePage.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await mobilePage.waitForTimeout(2500);
  const mobile = await measure(mobilePage, 844);
  await mobilePage.screenshot({ path: path.join(OUT, "home-mobile-390.png") });

  const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktopPage.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await desktopPage.waitForTimeout(2500);
  const desktop = await measure(desktopPage, 800);
  await desktopPage.screenshot({ path: path.join(OUT, "home-desktop-1280.png") });
  await desktopPage.screenshot({ path: path.join(OUT, "home-desktop-1280-full.png"), fullPage: true });

  const report = { capturedAt: new Date().toISOString(), mobile, desktop };
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
