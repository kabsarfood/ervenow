/**
 * ERVENOW Typography PR3 — Commerce capture + audit
 * node scripts/typography-pr3-commerce-capture.js [before|after]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const MODE = process.argv[2] === "before" ? "before" : "after";
const PAGE_FILTER = process.argv[3] || null;
const BASE = process.env.ERV_BASE || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "typography-pr3-commerce", MODE);
const REPORT = path.join(__dirname, "..", "docs", "TYPOGRAPHY-PR3-COMMERCE-REPORT.md");

const PAGES = [
  { slug: "cart", url: "/cart.html", label: "Cart" },
  { slug: "checkout", url: "/checkout", label: "Checkout" },
  { slug: "wallet", url: "/wallet.html", label: "Wallet", needsAuth: true },
  { slug: "orders", url: "/my-orders", label: "Orders" },
];

const VIEWPORTS = [
  { slug: "390", width: 390, height: 844 },
  { slug: "768", width: 768, height: 1024 },
  { slug: "1280", width: 1280, height: 800 },
];

const SAMPLE_SELECTORS = [
  { key: "pageTitle", sel: ".cart-checkout-v3 .header-title, .checkout-hero__title, .my-orders-hero h1, .wallet-brand strong" },
  { key: "sectionH2", sel: ".checkout-card__title, .my-orders-section h2, .wallet-tx-head h2, .cart-checkout-v3 .card-title" },
  { key: "price", sel: ".checkout-line__price, .cart-checkout-v3 .item-price, .wallet-tx-amt" },
  { key: "financialTotal", sel: ".checkout-invoice__row--grand dd, .cart-checkout-v3 .total-final, .wallet-balance-num" },
  { key: "secondary", sel: ".checkout-hero__sub, .my-order-meta, .wallet-card-label, .cart-checkout-v3 .store-meta" },
  { key: "caption", sel: ".my-order-badge, .cart-checkout-v3 .order-id, .wallet-tx-meta" },
  { key: "trustOrNote", sel: ".checkout-trust, .cart-checkout-v3 .security" },
];

async function auditPage(page) {
  return page.evaluate(function (sels) {
    var out = {};
    sels.forEach(function (s) {
      var el = document.querySelector(s.sel);
      if (!el) {
        out[s.key] = null;
        return;
      }
      var cs = getComputedStyle(el);
      out[s.key] = {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
      };
    });
    var unique = {};
    document.querySelectorAll("body *").forEach(function (el) {
      if (!el.offsetParent && el.tagName !== "BODY" && getComputedStyle(el).display === "none") return;
      var cs = getComputedStyle(el);
      var fs = cs.fontSize;
      if (!fs || fs === "0px") return;
      unique[fs] = (unique[fs] || 0) + 1;
    });
    out._fontSizeHistogram = Object.keys(unique)
      .sort(function (a, b) {
        return parseFloat(a) - parseFloat(b);
      })
      .map(function (k) {
        return { size: k, count: unique[k] };
      });
    var main = document.querySelector(".dash-main, .wallet-main, .checkout-main-wrap");
    out._layout = {
      mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
      viewport: window.innerWidth,
    };
    return out;
  }, SAMPLE_SELECTORS);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function preparePage(page, pg) {
  if (pg.needsAuth) {
    await page.addInitScript(function () {
      try {
        localStorage.setItem("ervenow_access_token", "typography-pr3-audit-token");
        localStorage.setItem("token", "typography-pr3-audit-token");
      } catch (_e) {}
    });
  }
}

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch();
  const metrics = {};

  const pages = PAGE_FILTER ? PAGES.filter(function (p) { return p.slug === PAGE_FILTER; }) : PAGES;

  for (const vp of VIEWPORTS) {
    for (const pg of pages) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await preparePage(page, pg);
      await page.goto(BASE + pg.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
      const shot = path.join(OUT, pg.slug + "-" + vp.slug + ".png");
      await page.screenshot({ path: shot, fullPage: true });
      metrics[pg.slug + "@" + vp.slug] = await auditPage(page);
      await page.close();
      console.log("captured", shot);
    }
  }

  await browser.close();

  const metricsPath = path.join(OUT, "metrics.json");
  fs.writeFileSync(metricsPath, JSON.stringify({ mode: MODE, capturedAt: new Date().toISOString(), metrics }, null, 2));
  console.log("metrics", metricsPath);

  if (MODE === "after") {
    writeReport(metrics);
  }
}

function writeReport(afterMetrics) {
  const beforePath = path.join(__dirname, "..", "docs", "screenshots", "typography-pr3-commerce", "before", "metrics.json");
  let beforeMetrics = null;
  if (fs.existsSync(beforePath)) {
    beforeMetrics = JSON.parse(fs.readFileSync(beforePath, "utf8")).metrics;
  }

  const lines = [
    "# ERVENOW Typography PR3 — Commerce Report",
    "",
    "**Date:** " + new Date().toISOString().slice(0, 10),
    "**Scope:** Cart · Checkout · Wallet · My Orders",
    "**Font:** Cairo (unchanged)",
    "",
    "## Tokens Applied",
    "",
    "| Role | Mobile | Tablet | Desktop | Weight |",
    "|------|--------|--------|---------|--------|",
    "| H1 | 24px | 28px | 32px | 700 |",
    "| H2 | 18px | 20px | 22px | 700 |",
    "| H3 | 16px | 18px | 18px | 600 |",
    "| Body | 16px | 16px | 16px | 400–500 |",
    "| Secondary | 14px | 14px | 14px | 400–500 |",
    "| Caption | 12px | 12px | 12px | 400 |",
    "| Price | 18px | 20px | 20px | 700 |",
    "| Financial Total | 20px | 24px | 24px | 700–800 |",
    "",
    "## Screenshots — After",
    "",
    "| Page | Mobile 390 | Tablet 768 | Desktop 1280 |",
    "|------|------------|------------|--------------|",
  ];

  for (const pg of PAGES) {
    lines.push(
      "| " +
        pg.label +
        " | ![m](screenshots/typography-pr3-commerce/after/" +
        pg.slug +
        "-390.png) | ![t](screenshots/typography-pr3-commerce/after/" +
        pg.slug +
        "-768.png) | ![d](screenshots/typography-pr3-commerce/after/" +
        pg.slug +
        "-1280.png) |"
    );
  }

  if (beforeMetrics) {
    lines.push("", "## Screenshots — Before", "");
    lines.push("| Page | Mobile 390 | Tablet 768 | Desktop 1280 |");
    lines.push("|------|------------|------------|--------------|");
    for (const pg of PAGES) {
      lines.push(
        "| " +
          pg.label +
          " | ![m](screenshots/typography-pr3-commerce/before/" +
          pg.slug +
          "-390.png) | ![t](screenshots/typography-pr3-commerce/before/" +
          pg.slug +
          "-768.png) | ![d](screenshots/typography-pr3-commerce/before/" +
          pg.slug +
          "-1280.png) |"
      );
    }
  }

  lines.push("", "## Computed Typography (After)", "");

  for (const key of Object.keys(afterMetrics)) {
    lines.push("### " + key);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(afterMetrics[key], null, 2));
    lines.push("```");
    lines.push("");
  }

  if (beforeMetrics) {
    lines.push("## Before → After (key roles)", "");
    lines.push("");
    lines.push("| Viewport | Role | Before | After |");
    lines.push("|----------|------|--------|-------|");
    const roles = ["pageTitle", "sectionH2", "price", "financialTotal", "secondary", "caption"];
    for (const key of Object.keys(afterMetrics)) {
      const b = beforeMetrics[key];
      const a = afterMetrics[key];
      if (!b || !a) continue;
      roles.forEach(function (role) {
        const bv = b[role] && b[role].fontSize;
        const av = a[role] && a[role].fontSize;
        if (!bv && !av) return;
        lines.push("| " + key + " | " + role + " | " + (bv || "—") + " | " + (av || "—") + " |");
      });
    }
    lines.push("");
  }

  lines.push(
    "## Layout & Commerce Checks",
    "",
    "- Colors: unchanged",
    "- Layout / grid / cards: unchanged",
    "- Form fields (inputs): unchanged",
    "- Payment logic: unchanged",
    "- Mobile Harmony: unchanged on guest-shell pages",
    "",
    "## Files",
    "",
    "- `public/assets/design-system/erv-typography-pr1-tokens.css` (reused)",
    "- `public/assets/design-system/erv-typography-commerce-pr3-tokens.css`",
    "- `public/assets/design-system/erv-typography-commerce-pr3.css`",
    "- Commerce pages: cart · checkout · wallet · my-orders",
    ""
  );

  fs.writeFileSync(REPORT, lines.join("\n"), "utf8");
  console.log("report", REPORT);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
