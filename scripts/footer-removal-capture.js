/**
 * ERVENOW Footer Removal — Before/After screenshots
 * node scripts/footer-removal-capture.js [before|after]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const MODE = process.argv[2] === "before" ? "before" : "after";
const BASE = process.env.ERV_BASE || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "footer-removal", MODE);

const PAGES = [
  { slug: "restaurants", url: "/restaurants" },
  { slug: "stores", url: "/stores" },
  { slug: "services", url: "/services" },
  { slug: "delivery", url: "/delivery-services" },
  { slug: "cart", url: "/cart.html" },
  { slug: "checkout", url: "/checkout" },
  { slug: "wallet", url: "/wallet.html", needsAuth: true },
  { slug: "orders", url: "/my-orders" },
  { slug: "login", url: "/login" },
  { slug: "dashboard", url: "/dashboard" },
  { slug: "driver", url: "/driver", needsAuth: true },
  { slug: "store", url: "/store-dashboard", needsAuth: true, authRole: "store" },
  { slug: "provider", url: "/services-provider", needsAuth: true, authRole: "service" },
  { slug: "admin", url: "/admin-dashboard", needsAuth: true, authRole: "admin" },
];

const VIEWPORTS = [
  { slug: "390", width: 390, height: 844 },
  { slug: "768", width: 768, height: 1024 },
  { slug: "1280", width: 1280, height: 800 },
];

function mockJson(role, url) {
  if (/\/api\/core\/me/.test(url)) {
    return { approved: true, profile: { role: role || "customer", status: "active" } };
  }
  if (/\/api\/admin\/me/.test(url)) {
    return { permissions: ["dashboard"], level: "full" };
  }
  if (/\/api\/store\/my-store/.test(url)) {
    return { store: { id: "s1", name: "متجر", type: "store" }, merchant_hub: {} };
  }
  if (/\/api\/services\/me\/dashboard/.test(url)) {
    return { panel_title: "لوحة مزود", stats: {}, bookings: [], profile: {} };
  }
  return { ok: true };
}

async function preparePage(page, pg) {
  if (pg.needsAuth) {
    await page.addInitScript(function () {
      try {
        localStorage.setItem("ervenow_access_token", "footer-audit-token");
        localStorage.setItem("token", "footer-audit-token");
      } catch (_e) {}
    });
    if (pg.authRole) {
      await page.route("**/api/**", async function (route) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockJson(pg.authRole, route.request().url())),
        });
      });
    }
  }
}

async function auditFooter(page) {
  return page.evaluate(function () {
    var site = document.querySelectorAll(".dash-site-footer, .store-site-footer, .lp-footer:not([hidden])");
    var visible = 0;
    site.forEach(function (el) {
      var cs = getComputedStyle(el);
      if (cs.display !== "none" && cs.visibility !== "hidden" && el.offsetHeight > 0) visible++;
    });
    return {
      footerCount: site.length,
      visibleFooters: visible,
      hasBottomNav: !!document.querySelector(".erv-bottom-nav, .mobile-bottom-nav, [class*='bottom-nav']"),
      viewport: window.innerWidth,
      scrollH: document.documentElement.scrollHeight,
    };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const metrics = {};

  for (const vp of VIEWPORTS) {
    for (const pg of PAGES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await preparePage(page, pg);
      await page.goto(BASE + pg.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
      const shot = path.join(OUT, pg.slug + "-" + vp.slug + ".png");
      await page.screenshot({ path: shot, fullPage: true });
      metrics[pg.slug + "@" + vp.slug] = await auditFooter(page);
      await page.close();
      console.log("captured", shot);
    }
  }

  await browser.close();
  const metricsPath = path.join(OUT, "metrics.json");
  fs.writeFileSync(metricsPath, JSON.stringify({ mode: MODE, capturedAt: new Date().toISOString(), metrics }, null, 2));
  console.log("metrics", metricsPath);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
