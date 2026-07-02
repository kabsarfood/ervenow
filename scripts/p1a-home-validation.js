/**
 * P1-A Home Validation — metrics @390x844
 * node scripts/p1a-home-validation.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const VIEWPORT = { width: 390, height: 844 };

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  const metrics = await page.evaluate(function (vh) {
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
        visiblePct: Math.round(
          ((Math.min(r.bottom, vh) - Math.max(r.top, 0)) / r.height) * 100
        ),
        inFold: r.top < vh && r.bottom > 0,
      };
    }

    function visibleTextAboveFold() {
      var words = [];
      var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walk.nextNode())) {
        var t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        var el = node.parentElement;
        if (!el) continue;
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        var r = el.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh || r.height <= 0) continue;
        if (el.closest(".erv-mobile-bottom-nav")) continue;
        words.push.apply(words, t.split(/\s+/).filter(Boolean));
      }
      return words;
    }

    function countInteractiveAboveFold() {
      var sel =
        'a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])';
      var n = 0;
      document.querySelectorAll(sel).forEach(function (el) {
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        var r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0 && r.height > 0) n++;
      });
      return n;
    }

    var header = rect(".lp-header");
    var banner = rect("#homeMainBanner:not([hidden])") || rect("#homeMainBanner");
    var bannerHidden = document.getElementById("homeMainBanner")?.hasAttribute("hidden");
    var firstCard = rect("#snHomeHub .sn-card");
    var cards = document.querySelectorAll("#snHomeHub .sn-card");
    var trust = rect(".sn-trust");
    var stats = rect(".sn-stats");
    var nav = rect(".erv-mobile-bottom-nav--ready, .erv-mobile-bottom-nav--shell");

    var cardsInFold = 0;
    cards.forEach(function (c) {
      var r = c.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) cardsInFold++;
    });

    var words = visibleTextAboveFold();
    var viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";

    return {
      viewport: { w: innerWidth, h: vh },
      viewportMeta,
      hasErvHomeIdentity: !!document.querySelector(".erv-home-identity"),
      hasSnWave: !!document.querySelector(".sn-wave"),
      hasTrustId: document.getElementById("trust") !== null,
      domOrder: {
        bannerBeforeHub:
          (document.getElementById("homeMainBanner")?.compareDocumentPosition(
            document.getElementById("snHomeHub")
          ) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
        hubBeforeTrust:
          (document.getElementById("snHomeHub")?.compareDocumentPosition(
            document.getElementById("trust")
          ) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      },
      header,
      banner: banner ? { ...banner, hiddenAttr: bannerHidden } : { hiddenAttr: bannerHidden },
      firstCard,
      cardsTotal: cards.length,
      cardsInFold,
      trust,
      stats,
      bottomNav: nav,
      wordsAboveFold: words.length,
      wordsSample: words.slice(0, 30),
      interactiveAboveFold: countInteractiveAboveFold(),
      scrollToFirstCard: firstCard ? Math.max(0, firstCard.top) : null,
    };
  }, VIEWPORT.height);

  const outDir = path.join(__dirname, "..", "docs", "screenshots", "p1b-validation");
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, "home-390-fold.png"), fullPage: false });
  fs.writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(metrics, null, 2));

  console.log(JSON.stringify(metrics, null, 2));
  await browser.close();
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
