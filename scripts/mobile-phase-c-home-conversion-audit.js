/**
 * Phase C — Home Conversion Audit (390px mobile, analysis only)
 * node scripts/mobile-phase-c-home-conversion-audit.js
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
  phase === "before" ? "phase-c-before" : "phase-c-after"
);
const VIEWPORT = { width: 390, height: 844 };

const SECTIONS = [
  { id: "restaurants", label: "مطاعم", sel: 'a.sn-card--restaurants, a[href="/restaurants"]', url: "/restaurants" },
  { id: "stores", label: "متاجر", sel: 'a.sn-card--stores, a[href="/stores"]', url: "/stores" },
  { id: "services", label: "خدمات", sel: 'a.sn-card--services, a[href="/services"]', url: "/services" },
  { id: "delivery", label: "توصيل", sel: 'a.sn-card--delivery, a[href="/delivery-services.html"]', url: "/delivery-services.html" },
];

function rectInfo(r) {
  if (!r || r.height <= 0) return null;
  return {
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    h: Math.round(r.height),
    visiblePct: Math.round(
      (Math.min(r.bottom, VIEWPORT.height) - Math.max(r.top, 0)) / r.height * 100
    ),
    inFold: r.top < VIEWPORT.height && r.bottom > 0,
  };
}

async function measureFold(page) {
  return page.evaluate(function (vh) {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      var r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) return null;
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        h: Math.round(r.height),
        w: Math.round(r.width),
        visiblePct: Math.round(
          (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / r.height * 100
        ),
        inFold: r.top < vh && r.bottom > 0,
        text: (el.textContent || "").trim().slice(0, 80),
      };
    }

    function visibleInFold(sel) {
      var nodes = document.querySelectorAll(sel);
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        var r = el.getBoundingClientRect();
        if (r.height <= 0) continue;
        if (r.top >= vh) continue;
        out.push({
          sel: sel,
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          h: Math.round(r.height),
          visiblePct: Math.round(
            (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / r.height * 100
          ),
          text: (el.textContent || "").trim().slice(0, 60),
        });
      }
      return out;
    }

    var banner = document.getElementById("homeMainBanner");
    var bannerHidden = banner ? banner.hidden : true;
    var bannerCs = banner ? getComputedStyle(banner) : null;

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollY: Math.round(window.scrollY),
      header: rect(".lp-header"),
      banner: rect("#homeMainBanner"),
      bannerMeta: banner
        ? {
            hidden: bannerHidden,
            display: bannerCs ? bannerCs.display : null,
            visibility: bannerCs ? bannerCs.visibility : null,
            hasSlides: !!banner.querySelector(".guest-offers-slide"),
            slideCount: banner.querySelectorAll(".guest-offers-slide").length,
            reserved: banner.classList.contains("guest-offers-carousel--reserved"),
          }
        : null,
      wave: rect(".sn-wave"),
      sectionLabel: rect(".sn-section__label"),
      sectionTitle: rect("#home-cats-title"),
      trust: rect(".sn-trust"),
      stats: rect("#stats"),
      bottomNav: rect(".erv-mobile-bottom-nav"),
      brandMid: rect(".lp-header__brand-mid"),
      logo: rect(".lp-header__logo-slot"),
      identity: rect(".erv-home-identity"),
      sections: {
        restaurants: rect('a.sn-card--restaurants'),
        stores: rect('a.sn-card--stores'),
        delivery: rect('a.sn-card--delivery'),
        services: rect('a.sn-card--services'),
      },
      foldItems: visibleInFold(
        ".lp-header, #homeMainBanner, .sn-section__label, #home-cats-title, a.sn-card, .sn-trust__item, .erv-mobile-bottom-nav"
      ).sort(function (a, b) {
        return a.top - b.top;
      }),
    };
  }, VIEWPORT.height);
}

async function measureConversion(page) {
  const results = [];
  for (const sec of SECTIONS) {
    const t0 = Date.now();
    const info = await page.evaluate(function (args) {
      var el = document.querySelector(args.sel);
      if (!el) return { found: false };
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var scrollNeeded = Math.max(0, Math.ceil(r.top - 120));
      return {
        found: true,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        h: Math.round(r.height),
        visiblePct: r.height
          ? Math.round(
              (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / r.height * 100
            )
          : 0,
        scrollNeeded: scrollNeeded,
        href: el.getAttribute("href"),
        tapReady: r.height > 0 && cs.display !== "none" && !el.hidden,
      };
    }, { sel: sec.sel });

    let navMs = null;
    if (info.found && info.tapReady) {
      const navStart = Date.now();
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
          page.click(sec.sel, { timeout: 5000 }),
        ]);
        navMs = Date.now() - navStart;
      } catch (e) {
        navMs = null;
      }
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(function () {});
      await page.waitForTimeout(1200);
    }

    results.push({
      id: sec.id,
      label: sec.label,
      url: sec.url,
      timeToVisibleMs: Date.now() - t0,
      layout: info,
      navigationMs: navMs,
      estimatedTapSeconds: info.found
        ? info.scrollNeeded > 0
          ? +(1.2 + info.scrollNeeded / 400).toFixed(1)
          : 0.8
        : null,
    });
  }
  return results;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize(VIEWPORT);

  const navStart = Date.now();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(function () {});
  const domReadyMs = Date.now() - navStart;

  const timeline = [];
  const marks = [0, 800, 3000, 5000, 10000];
  for (const ms of marks) {
    if (ms > 0) await page.waitForTimeout(ms - (timeline.length ? marks[timeline.length - 1] : 0));
    const fold = await measureFold(page);
    timeline.push({ atMs: ms, fold });
    if (ms === 0) {
      await page.screenshot({ path: path.join(OUT, "home-fold-390.png"), fullPage: false });
    }
    if (ms === 5000) {
      await page.screenshot({ path: path.join(OUT, "home-at-5s-390.png"), fullPage: false });
    }
    if (ms === 10000) {
      await page.screenshot({ path: path.join(OUT, "home-at-10s-390.png"), fullPage: false });
    }
  }

  await page.screenshot({ path: path.join(OUT, "home-full-390.png"), fullPage: true });

  const conversion = await measureConversion(page);

  const firstImpression = await page.evaluate(function () {
    var hasBrand = !!document.querySelector(".lp-header__logo-img, .lp-brand__name");
    var hasTagline = !!document.querySelector(".lp-brand__tag");
    var hasSectionTitle = !!document.getElementById("home-cats-title");
    var hasTrust = !!document.querySelector(".sn-trust");
    var hasWhy = !!document.getElementById("why");
    var cards = document.querySelectorAll("a.sn-card");
    return {
      hasBrand,
      hasTagline,
      taglineText: document.querySelector(".lp-brand__tag")
        ? document.querySelector(".lp-brand__tag").textContent.trim()
        : "",
      sectionTitle: document.getElementById("home-cats-title")
        ? document.getElementById("home-cats-title").textContent.trim()
        : "",
      sectionCards: cards.length,
      trustItems: document.querySelectorAll(".sn-trust__item").length,
      hasExplainerBelowFold: hasWhy,
      metaDescription: document.querySelector('meta[name="description"]')
        ? document.querySelector('meta[name="description"]').getAttribute("content")
        : "",
    };
  });

  await browser.close();

  const fold10s = timeline[timeline.length - 1].fold;
  const report = {
    capturedAt: new Date().toISOString(),
    phase: phase === "before" ? "before" : "after",
    viewport: VIEWPORT,
    domReadyMs,
    firstImpression,
    timeline,
    conversion,
    foldSummary: {
      headerH: fold10s.header ? fold10s.header.h : null,
      bannerH: fold10s.banner ? fold10s.banner.h : 0,
      bannerVisible: !!(fold10s.banner && fold10s.banner.inFold),
      firstSectionCardTop: fold10s.sections.restaurants ? fold10s.sections.restaurants.top : null,
      cardsInFold: Object.keys(fold10s.sections).filter(function (k) {
        return fold10s.sections[k] && fold10s.sections[k].inFold;
      }),
      cardsPartial: Object.keys(fold10s.sections)
        .filter(function (k) {
          var s = fold10s.sections[k];
          return s && s.inFold && s.visiblePct < 100;
        })
        .map(function (k) {
          return { id: k, visiblePct: fold10s.sections[k].visiblePct };
        }),
    },
    screenshots: {
      fold: "home-fold-390.png",
      at5s: "home-at-5s-390.png",
      at10s: "home-at-10s-390.png",
      full: "home-full-390.png",
    },
  };

  const jsonPath = path.join(OUT, "audit-metrics.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("Saved", jsonPath);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
