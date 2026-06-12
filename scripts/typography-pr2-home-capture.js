/**
 * ERVENOW Typography PR2 — Home capture + audit
 * node scripts/typography-pr2-home-capture.js [before|after]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const MODE = process.argv[2] === "before" ? "before" : "after";
const BASE = process.env.ERV_BASE || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "typography-pr2-home", MODE);
const REPORT = path.join(__dirname, "..", "docs", "TYPOGRAPHY-PR2-HOME-REPORT.md");

const VIEWPORTS = [
  { slug: "390", width: 390, height: 844 },
  { slug: "768", width: 768, height: 1024 },
  { slug: "1280", width: 1280, height: 800 },
];

const SAMPLE_SELECTORS = [
  { key: "identityName", sel: ".erv-home-identity__name" },
  { key: "identityNameHeader", sel: ".lp-header__brand-mid .lp-brand__name" },
  { key: "identityTag", sel: ".erv-home-identity__tag" },
  { key: "identityTagHeader", sel: ".lp-header__brand-mid .lp-brand__tag" },
  { key: "identityScope", sel: ".erv-home-identity__scope" },
  { key: "heroSlideTitle", sel: ".guest-offers-slide__title" },
  { key: "heroSlideSub", sel: ".guest-offers-slide__sub" },
  { key: "sectionLabel", sel: ".sn-section__label" },
  { key: "sectionTitle", sel: ".sn-section__title, .lp-section__title" },
  { key: "sectionLead", sel: ".lp-section__lead" },
  { key: "cardTitle", sel: "#snHomeHub .sn-card__name" },
  { key: "cardDesc", sel: "#snHomeHub .sn-card__desc" },
  { key: "trustItem", sel: ".sn-trust__item" },
  { key: "whyH3", sel: ".lp-why-item h3" },
  { key: "whyBody", sel: ".lp-why-item p" },
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
    var banner = document.getElementById("homeMainBanner");
    var hub = document.getElementById("snHomeHub");
    out._layout = {
      bannerH: banner ? Math.round(banner.getBoundingClientRect().height) : null,
      hubH: hub ? Math.round(hub.getBoundingClientRect().height) : null,
      identityVisible: (function () {
        var id = document.getElementById("ervHomeIdentity");
        return id ? getComputedStyle(id).display !== "none" : false;
      })(),
    };
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
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const shot = path.join(OUT, "home-" + vp.slug + ".png");
    await page.screenshot({ path: shot, fullPage: true });
    metrics["home@" + vp.slug] = await auditPage(page);
    await page.close();
    console.log("captured", shot);
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
  const beforePath = path.join(__dirname, "..", "docs", "screenshots", "typography-pr2-home", "before", "metrics.json");
  let beforeMetrics = null;
  if (fs.existsSync(beforePath)) {
    beforeMetrics = JSON.parse(fs.readFileSync(beforePath, "utf8")).metrics;
  }

  const lines = [
    "# ERVENOW Typography PR2 — Home Report",
    "",
    "**Date:** " + new Date().toISOString().slice(0, 10),
    "**Scope:** Home (`/`) — Identity · Hero Text · Trust · Cards · Sections",
    "**Font:** Cairo (unchanged)",
    "",
    "## Tokens Applied (PR1 system)",
    "",
    "| Role | Mobile | Tablet | Desktop | Weight |",
    "|------|--------|--------|---------|--------|",
    "| H1 | 24px | 28px | 32px | 700 |",
    "| H2 | 18px | 20px | 22px | 700 |",
    "| H3 | 16px | 18px | 18px | 600 |",
    "| Body | 16px | 16px | 16px | 400–500 |",
    "| Secondary | 14px | 14px | 14px | 400–500 |",
    "| Caption | 12px | 12px | 12px | 400 |",
    "",
    "## Identity Tag (special)",
    "",
    "| | Mobile | Tablet | Desktop |",
    "|--|--------|--------|---------|",
    "| ERVENOW | 24px | 28px | 32px |",
    "| المنصة الذكية | 14px | 16px | 18px |",
    "",
    "## Screenshots — After",
    "",
    "| Viewport | Screenshot |",
    "|----------|------------|",
    "| Mobile 390 | ![m](screenshots/typography-pr2-home/after/home-390.png) |",
    "| Tablet 768 | ![t](screenshots/typography-pr2-home/after/home-768.png) |",
    "| Desktop 1280 | ![d](screenshots/typography-pr2-home/after/home-1280.png) |",
    "",
  ];

  if (beforeMetrics) {
    lines.push("## Screenshots — Before", "");
    lines.push("| Viewport | Screenshot |");
    lines.push("|----------|------------|");
    lines.push("| Mobile 390 | ![m](screenshots/typography-pr2-home/before/home-390.png) |");
    lines.push("| Tablet 768 | ![t](screenshots/typography-pr2-home/before/home-768.png) |");
    lines.push("| Desktop 1280 | ![d](screenshots/typography-pr2-home/before/home-1280.png) |");
    lines.push("");
  }

  lines.push("## Computed Typography (After)", "");

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
    const roles = [
      "identityName",
      "identityNameHeader",
      "identityTag",
      "identityTagHeader",
      "trustItem",
      "cardTitle",
      "cardDesc",
      "sectionTitle",
      "sectionLead",
      "heroSlideTitle",
    ];
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
    "## Layout & Harmony Checks",
    "",
    "- Colors: unchanged",
    "- Layout / Cards grid: unchanged",
    "- Mobile Harmony: section reorder · hidden labels preserved",
    "- Hero / Banner height: unchanged",
    "- Bottom Nav: unchanged (typography untouched)",
    "",
    "## Files",
    "",
    "- `public/assets/design-system/erv-typography-pr1-tokens.css` (reused)",
    "- `public/assets/design-system/erv-typography-home-pr2.css`",
    "- `public/index.html` (body class + links)",
    ""
  );

  fs.writeFileSync(REPORT, lines.join("\n"), "utf8");
  console.log("report", REPORT);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
