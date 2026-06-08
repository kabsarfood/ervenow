/**
 * Post banner-removal audit — full-page screenshots + metrics
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "review-screenshots", "post-banner-removal");
const BEFORE_JSON = path.join(__dirname, "..", "docs", "review-screenshots", "banner-audit", "banner-audit.json");

const PAGES = [
  {
    id: "home",
    url: "/",
    label: "الرئيسية",
    mainSel: "#homeHeroSection",
    headerSel: ".lp-header",
    beforeBannerSel: "#homeHeroBanner",
  },
  {
    id: "dashboard",
    url: "/dashboard",
    label: "لوحة الزائر",
    mainSel: "#platformHeroSection",
    headerSel: ".dash-site-header",
    beforeBannerSel: "#ervVisitorBanner",
  },
  {
    id: "restaurants",
    url: "/restaurants",
    label: "المطاعم",
    mainSel: ".guest-section-hero",
    headerSel: ".dash-site-header",
    beforeBannerSel: "#ervRestaurantsBanner",
  },
  {
    id: "stores",
    url: "/stores",
    label: "المتاجر",
    mainSel: ".guest-section-hero",
    headerSel: ".dash-site-header",
    beforeBannerSel: "#ervStoresBanner",
  },
  {
    id: "services",
    url: "/services",
    label: "الخدمات",
    mainSel: ".guest-section-hero",
    headerSel: ".dash-site-header",
    beforeBannerSel: "#ervServicesBanner",
  },
  {
    id: "delivery",
    url: "/delivery-services.html",
    label: "التوصيل",
    mainSel: ".guest-section-hero",
    headerSel: ".dash-site-header",
    beforeBannerSel: "#ervDeliveryBanner",
  },
];

function bytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

async function auditPage(page, cfg, viewportName, viewport) {
  const requests = [];
  const responses = [];

  const onReq = (r) => requests.push({ url: r.url(), type: r.resourceType() });
  const onRes = (r) => {
    responses.push({
      url: r.url(),
      status: r.status(),
      type: r.request().resourceType(),
    });
  };

  page.on("request", onReq);
  page.on("response", onRes);

  await page.setViewportSize(viewport);
  const t0 = Date.now();
  await page.goto(BASE + cfg.url, { waitUntil: "networkidle", timeout: 90000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(1500);

  const metrics = await page.evaluate(function (opts) {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var st = window.getComputedStyle(el);
      return {
        top: Math.round(r.top + window.scrollY),
        height: Math.round(r.height),
        width: Math.round(r.width),
        visible: r.height > 0 && st.display !== "none" && st.visibility !== "hidden" && !el.hidden,
      };
    }

    function countViewportElements() {
      var vh = window.innerHeight;
      var nodes = document.querySelectorAll(
        "header, section, main, article, .card, .sn-card, .sn-home-card, .guest-section-hero, .guest-offers-carousel, nav, h1, h2, button, a.lp-hero__cta, a.sn-hero__cta"
      );
      var visible = 0;
      nodes.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var st = window.getComputedStyle(el);
        if (r.height <= 0 || st.display === "none" || st.visibility === "hidden" || el.hidden) return;
        if (r.bottom > 0 && r.top < vh) visible += 1;
      });
      return visible;
    }

    var header = rect(opts.headerSel);
    var main = rect(opts.mainSel);
    var banner = rect(opts.beforeBannerSel);
    var offers = rect("#guestOffersCarousel");

    var resources = performance.getEntriesByType("resource");
    var cssBytes = 0;
    var jsBytes = 0;
    var cssCount = 0;
    var jsCount = 0;
    resources.forEach(function (r) {
      var u = r.name;
      if (/\.css(\?|$)/i.test(u)) {
        cssCount += 1;
        cssBytes += r.transferSize || r.encodedBodySize || 0;
      }
      if (/\.js(\?|$)/i.test(u)) {
        jsCount += 1;
        jsBytes += r.transferSize || r.encodedBodySize || 0;
      }
    });

    var nav = performance.getEntriesByType("navigation")[0] || {};

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      header,
      main,
      heroBannerRemoved: !banner || !banner.visible,
      offersCarousel: offers,
      firstViewportElementCount: countViewportElements(),
      heightBeforeMainSection: main && main.visible ? main.top : null,
      documentHeight: Math.round(document.documentElement.scrollHeight),
      timing: {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        load: Math.round(nav.loadEventEnd || 0),
        ttfb: Math.round(nav.responseStart || 0),
      },
      assets: { cssCount, jsCount, cssBytes, jsBytes },
    };
  }, {
    headerSel: cfg.headerSel,
    mainSel: cfg.mainSel,
    beforeBannerSel: cfg.beforeBannerSel,
  });

  const shotName = cfg.id + "-" + viewportName + "-full.png";
  await page.screenshot({
    path: path.join(OUT, shotName),
    fullPage: true,
  });

  page.off("request", onReq);
  page.off("response", onRes);

  const networkCount = responses.filter(function (r) {
    return r.status >= 200 && r.status < 400;
  }).length;

  const bannerEngineLoaded = responses.some(function (r) {
    return /banner-engine\.(js|css)/i.test(r.url);
  });

  return {
    page: cfg.id,
    label: cfg.label,
    viewport: viewportName,
    loadMs,
    networkRequests: networkCount,
    bannerEngineLoaded,
    screenshot: "docs/review-screenshots/post-banner-removal/" + shotName,
    ...metrics,
  };
}

function loadBefore() {
  if (!fs.existsSync(BEFORE_JSON)) return null;
  return JSON.parse(fs.readFileSync(BEFORE_JSON, "utf8"));
}

function beforeRow(before, pageId, vp) {
  if (!before) return null;
  var m = before.measurements.find(function (x) {
    if (pageId === "dashboard") return x.page === "dashboard-hero" && x.viewport === vp;
    return x.page === pageId && x.viewport === vp;
  });
  if (!m) return null;
  var bannerH = m.banner && m.banner.visible ? m.banner.wrap.h : 0;
  var headerH = m.header ? m.header.wrap.h : 0;
  return {
    bannerHeight: bannerH,
    headerHeight: headerH,
    offsetBeforeMain: headerH + bannerH,
    bannerVisible: !!(m.banner && m.banner.visible),
  };
}

function fileSizeIfExists(rel) {
  var p = path.join(__dirname, "..", "public", "assets", rel);
  if (!fs.existsSync(p)) return 0;
  return fs.statSync(p).size;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const before = loadBefore();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const measurements = [];
  for (const cfg of PAGES) {
    for (const [name, vp] of [
      ["mobile-390", { width: 390, height: 844 }],
      ["desktop-1280", { width: 1280, height: 800 }],
    ]) {
      measurements.push(await auditPage(page, cfg, name, vp));
    }
  }

  await browser.close();

  const bannerEngineJsNow = fileSizeIfExists("banner-engine.js");
  const bannerEngineCssNow = fileSizeIfExists("banner-engine.css");

  const report = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE,
    note: "بعد إزالة بنرات Hero من الواجهة — بنرات العروض (#guestOffersCarousel) ما زالت في لوحة الزائر",
    assetSizesOnDisk: {
      bannerEngineJs: bannerEngineJsNow,
      bannerEngineCss: bannerEngineCssNow,
      bannerEngineJsHuman: bytes(bannerEngineJsNow),
      bannerEngineCssHuman: bytes(bannerEngineCssNow),
    },
    beforeReference: before ? before.capturedAt : null,
    measurements,
    comparisons: measurements.map(function (m) {
      var b = beforeRow(before, m.page, m.viewport);
      return {
        page: m.page,
        viewport: m.viewport,
        before: b,
        after: {
          heightBeforeMainSection: m.heightBeforeMainSection,
          heroBannerRemoved: m.heroBannerRemoved,
          firstViewportElementCount: m.firstViewportElementCount,
          networkRequests: m.networkRequests,
          cssBytes: m.assets.cssBytes,
          jsBytes: m.assets.jsBytes,
          loadMs: m.loadMs,
          bannerEngineLoaded: m.bannerEngineLoaded,
        },
        delta: b
          ? {
              heightBeforeMainPx: m.heightBeforeMainSection != null ? m.heightBeforeMainSection - b.offsetBeforeMain : null,
              bannerRemovedPx: b.bannerHeight,
            }
          : null,
      };
    }),
  };

  fs.writeFileSync(path.join(OUT, "post-banner-removal-audit.json"), JSON.stringify(report, null, 2));
  console.log("Saved to", OUT);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
