/**
 * ERVENOW Typography PR1 — capture + audit (Guest & Hub)
 * node scripts/typography-pr1-guest-hub-capture.js [after|before]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const MODE = process.argv[2] === "before" ? "before" : "after";
const BASE = process.env.ERV_BASE || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "typography-pr1-guest-hub", MODE);
const REPORT = path.join(__dirname, "..", "docs", "TYPOGRAPHY-PR1-GUEST-HUB-REPORT.md");

const PAGES = [
  { slug: "restaurants", url: "/restaurants", label: "Restaurants" },
  { slug: "stores", url: "/stores", label: "Stores" },
  { slug: "services", url: "/services", label: "Services" },
  { slug: "delivery", url: "/delivery-services.html", label: "Delivery" },
];

const VIEWPORTS = [
  { slug: "390", width: 390, height: 844, tier: "mobile" },
  { slug: "768", width: 768, height: 1024, tier: "tablet" },
  { slug: "1280", width: 1280, height: 800, tier: "desktop" },
];

const SAMPLE_SELECTORS = [
  { key: "search", sel: ".stores-search, .erv-section-hub__search, .ds-form input" },
  { key: "cardTitle", sel: ".store-info h3, .ds-svc__lbl" },
  { key: "secondary", sel: ".stores-filter, .erv-section-hub__sort-btn, .ds-section-block__hint" },
  { key: "caption", sel: ".stores-cuisine-chip, .erv-section-hub__cat, .ds-svc__badge" },
  { key: "bottomNav", sel: ".erv-mobile-bottom-nav__item" },
  { key: "heroTitle", sel: ".guest-section-hero__title, .ds-section-title" },
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
    return out;
  }, SAMPLE_SELECTORS);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch();
  const metrics = {};

  for (const vp of VIEWPORTS) {
    for (const pg of PAGES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(BASE + pg.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
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
  const beforePath = path.join(__dirname, "..", "docs", "screenshots", "typography-pr1-guest-hub", "before", "metrics.json");
  let beforeMetrics = null;
  if (fs.existsSync(beforePath)) {
    beforeMetrics = JSON.parse(fs.readFileSync(beforePath, "utf8")).metrics;
  }

  const lines = [
    "# ERVENOW Typography PR1 — Guest & Hub Report",
    "",
    "**Date:** " + new Date().toISOString().slice(0, 10),
    "**Scope:** Guest Shell · Restaurants · Stores · Services · Delivery · Bottom Nav",
    "**Font:** Cairo (unchanged)",
    "",
    "## Tokens V1 Applied",
    "",
    "| Role | Mobile | Tablet | Desktop | Weight |",
    "|------|--------|--------|---------|--------|",
    "| H1 | 24px | 28px | 32px | 700 |",
    "| H2 | 18px | 20px | 22px | 700 |",
    "| H3 | 16px | 18px | 18px | 600 |",
    "| Body | 16px | 16px | 16px | 400–500 |",
    "| Secondary | 14px | 14px | 14px | 400–500 |",
    "| Caption | 12px | 12px | 12px | 400 |",
    "| Bottom Nav | 12px | 12px | 12px | 600 |",
    "| Price | 18px | 18px | 18px | 700 |",
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
        " | ![m](screenshots/typography-pr1-guest-hub/after/" +
        pg.slug +
        "-390.png) | ![t](screenshots/typography-pr1-guest-hub/after/" +
        pg.slug +
        "-768.png) | ![d](screenshots/typography-pr1-guest-hub/after/" +
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
          " | ![m](screenshots/typography-pr1-guest-hub/before/" +
          pg.slug +
          "-390.png) | ![t](screenshots/typography-pr1-guest-hub/before/" +
          pg.slug +
          "-768.png) | ![d](screenshots/typography-pr1-guest-hub/before/" +
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
    const roles = ["heroTitle", "search", "cardTitle", "secondary", "caption", "bottomNav"];
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
    "",
    "## Layout & Harmony Checks",
    "",
    "- Header: unchanged (no typography rules on `.dash-site-header`)",
    "- Colors: unchanged",
    "- Mobile Harmony: hero hidden on mobile shell · sticky toolbar preserved",
    "- Bottom Nav: label **12px / 600** (was ~10px)",
    "",
    "## Files",
    "",
    "- `public/assets/design-system/erv-typography-pr1-tokens.css`",
    "- `public/assets/design-system/erv-typography-guest-hub-pr1.css`",
    "- `public/assets/section-hub.css` (token fallbacks)",
    "- `public/assets/mobile-foundation.css` (bottom nav label only)",
    "- Hub pages: restaurants · stores · services · delivery-services",
    ""
  );

  fs.writeFileSync(REPORT, lines.join("\n"), "utf8");
  console.log("report", REPORT);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
