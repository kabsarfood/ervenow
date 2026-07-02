/**
 * EPPC Restaurants Validation — mobile @390 + desktop @1280
 * Usage: node --use-system-ca scripts/eppc-restaurants-validation.js [before|after]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const LABEL = (process.argv[2] || "after").replace(/[^a-z0-9_-]/gi, "-");
const OUT = path.join(__dirname, "..", "docs", "screenshots", "restaurants-eppc-validation");

function visibleRect(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    left: Math.round(r.left),
    right: Math.round(r.right),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

function measurePage(page, viewportH) {
  return page.evaluate(
    ({ viewportH, visibleRectSource }) => {
      const visibleRect = new Function(`return (${visibleRectSource});`)();

      function rect(sel) {
        const r = visibleRect(sel);
        if (!r) return null;
        return {
          ...r,
          inFold: r.top < viewportH && r.bottom > 0,
        };
      }

      function textWordsInFold() {
        const useful = [];
        const noise = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walk.nextNode())) {
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          const el = node.parentElement;
          if (!el || el.closest(".erv-mobile-bottom-nav")) continue;
          if (el.closest("[aria-hidden='true']")) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.bottom <= 0 || r.top >= viewportH) continue;
          const words = text.split(/\s+/).filter(Boolean);
          const isUseful =
            !!el.closest(".guest-section-hero__title") ||
            !!el.closest(".guest-section-hero__sub") ||
            !!el.closest(".stores-search-wrap") ||
            !!el.closest(".erv-section-hub__sort") ||
            !!el.closest("#hubCountLine") ||
            !!el.closest("#storesCuisineBar") ||
            !!el.closest(".store-card h3") ||
            !!el.closest(".store-card__btn");
          words.forEach((w) => (isUseful ? useful : noise).push(w));
        }
        return { useful: useful.length, noise: noise.length };
      }

      function countVisible(sel) {
        let total = 0;
        document.querySelectorAll(sel).forEach((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0) total++;
        });
        return total;
      }

      let cardsInFold = 0;
      document.querySelectorAll(".store-card").forEach((card) => {
        const r = card.getBoundingClientRect();
        if (r.top < viewportH && r.bottom > 0) cardsInFold++;
      });

      const firstInteractive = rect("#storeSearch") || rect(".stores-cuisine-chip") || rect(".store-card__btn");
      const firstCard = rect(".store-card");
      const firstCta = rect(".store-card__btn");
      const hero = rect(".guest-section-hero");
      const toolbar = rect(".stores-toolbar");
      const search = rect("#storeSearch");
      const sort = rect("#hubSortBar");
      const cuisine = rect("#storesRestaurantCuisineBlock");
      const grid = rect("#container");

      return {
        viewport: { w: innerWidth, h: viewportH },
        title: document.title,
        hero,
        toolbar,
        search,
        sort,
        cuisine,
        grid,
        firstInteractiveTop: firstInteractive ? firstInteractive.top : null,
        firstCardTop: firstCard ? firstCard.top : null,
        firstCtaTop: firstCta ? firstCta.top : null,
        cardsInFold,
        cardCount: countVisible(".store-card"),
        chipCount: countVisible(".stores-cuisine-chip"),
        sortCount: countVisible(".erv-section-hub__sort-btn"),
        emptyVisible: !!rect(".stores-empty"),
        skeletonVisible: countVisible(".store-skel"),
        countLine: (document.querySelector("#hubCountLine")?.textContent || "").trim(),
        searchDisabled: !!document.querySelector("#storeSearch")?.disabled,
        words: textWordsInFold(),
      };
    },
    { viewportH, visibleRectSource: visibleRect.toString() }
  );
}

async function capture(browser, name, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${BASE}/restaurants`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  const metrics = await measurePage(page, viewport.height);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${name}.png`) });
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${name}-full.png`), fullPage: true });
  await page.close();
  return metrics;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const mobile = await capture(browser, "mobile-390", { width: 390, height: 844 });
  const desktop = await capture(browser, "desktop-1280", { width: 1280, height: 800 });
  const report = { capturedAt: new Date().toISOString(), label: LABEL, mobile, desktop };
  fs.writeFileSync(path.join(OUT, `${LABEL}-metrics.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
