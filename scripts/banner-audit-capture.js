/**
 * Banner audit: measure + screenshot hero banners vs guest offers
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.REVIEW_BASE_URL || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "review-screenshots", "banner-audit");

const PAGES = [
  { id: "home", url: "/", bannerSel: "#homeHeroBanner", label: "الرئيسية" },
  { id: "dashboard-hero", url: "/dashboard", bannerSel: "#ervVisitorBanner", label: "لوحة الزائر — بنر hero" },
  { id: "dashboard-offers", url: "/dashboard", bannerSel: "#guestOffersCarousel", label: "لوحة الزائر — عروض", scrollTo: "#guestOffersCarousel" },
  { id: "restaurants", url: "/restaurants", bannerSel: "#ervRestaurantsBanner", label: "المطاعm" },
  { id: "stores", url: "/stores", bannerSel: "#ervStoresBanner", label: "المتاجر" },
  { id: "services", url: "/services", bannerSel: "#ervServicesBanner", label: "الخدمات" },
  { id: "delivery", url: "/delivery-services.html", bannerSel: "#ervDeliveryBanner", label: "التوصيل" },
];

async function measurePage(page, cfg, viewportName, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + cfg.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  if (cfg.scrollTo) {
    await page.locator(cfg.scrollTo).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }

  const data = await page.evaluate(function (bannerSel) {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el || el.hidden) return null;
      var r = el.getBoundingClientRect();
      var inner = el.querySelector(".sn-home-banner__inner, .guest-offers-shell, .erv-banner-unified--slot .sn-home-banner__inner");
      var ir = inner ? inner.getBoundingClientRect() : r;
      var img = el.querySelector("img.sn-hero-carousel__img, img.sn-home-banner__bg-img, .guest-offers-slide__img");
      return {
        visible: r.height > 0 && r.width > 0,
        wrap: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
        inner: inner ? { w: Math.round(ir.width), h: Math.round(ir.height) } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        hasImg: !!img,
        objectFit: img ? getComputedStyle(img).objectFit : null,
      };
    }
    return {
      banner: rect(bannerSel),
      header: rect("header, .dash-site-header, .lp-header"),
    };
  }, cfg.bannerSel);

  const shotName = cfg.id + "-" + viewportName + ".png";
  if (cfg.id === "dashboard-offers") {
    var el = page.locator("#guestOffersCarousel");
    if (await el.isVisible()) {
      await el.screenshot({ path: path.join(OUT, shotName) });
    } else {
      await page.screenshot({ path: path.join(OUT, shotName), fullPage: false });
    }
  } else {
    var banner = page.locator(cfg.bannerSel);
    if (await banner.isVisible()) {
      await banner.screenshot({ path: path.join(OUT, shotName) });
    } else {
      await page.screenshot({ path: path.join(OUT, shotName), clip: { x: 0, y: 0, width: viewport.width, height: Math.min(500, viewport.height) } });
    }
  }

  return { viewport: viewportName, ...data, screenshot: "docs/review-screenshots/banner-audit/" + shotName };
}

async function fetchBannerMeta() {
  const targets = ["home", "visitor_dashboard", "restaurants", "stores", "services", "delivery"];
  const result = {};
  for (const t of targets) {
    try {
      const r = await fetch(BASE + "/api/core/banners?target=" + encodeURIComponent(t));
      const j = await r.json();
      result[t] = {
        count: (j.banners || []).length,
        banners: (j.banners || []).map(function (b) {
          return { id: b.id, title: b.title, display_mode: b.display_mode, hasImage: !!b.image_url };
        }),
      };
    } catch (e) {
      result[t] = { error: String(e.message || e) };
    }
  }
  return result;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const report = {
    capturedAt: new Date().toISOString(),
    spec: { width: 1920, height: 730, aspect: "1920/730", objectFit: "cover" },
    api: await fetchBannerMeta(),
    measurements: [],
  };

  for (const cfg of PAGES) {
    for (const [name, vp] of [
      ["mobile-390", { width: 390, height: 844 }],
      ["desktop-1280", { width: 1280, height: 800 }],
    ]) {
      report.measurements.push({ page: cfg.id, label: cfg.label, ...(await measurePage(page, cfg, name, vp)) });
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "banner-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
