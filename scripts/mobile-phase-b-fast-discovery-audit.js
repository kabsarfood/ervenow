/**
 * Phase B — Fast Discovery Audit (390px mobile)
 * node scripts/mobile-phase-b-fast-discovery-audit.js
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
  phase === "before" ? "phase-b-before" : "phase-b-after"
);
const VIEWPORT = { width: 390, height: 844 };

const PAGES = [
  {
    id: "restaurants",
    url: "/restaurants",
    label: "المطاعم",
    firstResultSel: ".store-card:not(.stores-grid--skeleton .store-card), .store-card",
    actionSel: ".store-card .store-card__btn",
    actionLabel: "أول مطعم (فتح المتجر)",
    waitForResult: async (page) => {
      await page.waitForSelector(".store-card:not(.stores-grid--skeleton .store-card)", {
        timeout: 20000,
      }).catch(async () => {
        await page.waitForSelector(".erv-section-hub__empty, .store-card", { timeout: 20000 }).catch(() => {});
      });
    },
  },
  {
    id: "stores",
    url: "/stores",
    label: "المتاجر",
    firstResultSel: ".store-card",
    actionSel: ".store-card .store-card__btn",
    actionLabel: "أول متجر",
    waitForResult: async (page) => {
      await page.waitForFunction(
        () => {
          var c = document.getElementById("container");
          if (!c) return false;
          return !c.classList.contains("stores-grid--skeleton") || c.querySelector(".erv-section-hub__empty");
        },
        { timeout: 20000 }
      ).catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    id: "services",
    url: "/services",
    label: "الخدمات",
    firstResultSel: "#container .store-card:not(.stores-grid--skeleton .store-card), #container .store-card",
    actionSel: "#container .store-card .store-card__btn",
    actionLabel: "أول خدمة / طلب",
    waitForResult: async (page) => {
      await page.waitForFunction(
        () => {
          var c = document.getElementById("container");
          var cards = document.getElementById("svcOrderCards");
          if (c && !c.classList.contains("stores-grid--skeleton")) return true;
          if (cards && cards.children.length) return true;
          return false;
        },
        { timeout: 20000 }
      ).catch(() => {});
      await page.waitForTimeout(500);
    },
  },
  {
    id: "delivery",
    url: "/delivery-services.html",
    label: "التوصيل",
    firstResultSel: "#dsServiceChips .ds-svc",
    actionSel: "#dsServiceChips .ds-svc:not(.is-soon)",
    actionLabel: "أول طلب توصيل (اختيار خدمة + بدء النموذج)",
    waitForResult: async (page) => {
      await page.waitForSelector("#dsServiceChips .ds-svc", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(400);
    },
  },
];

async function measureLayout(page, cfg) {
  return page.evaluate(function (pageId) {
    function rect(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return {
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        visible: r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
      };
    }
    function sumHeights(sels) {
      var total = 0;
      sels.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          var cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || el.hidden) return;
          var r = el.getBoundingClientRect();
          if (r.height > 0) total += r.height;
        });
      });
      return Math.round(total);
    }
    function visibleFirst(sel) {
      var list = document.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        var r = el.getBoundingClientRect();
        if (r.height > 0 && r.width > 0) return el;
      }
      return null;
    }
    var firstCard =
      pageId === "services"
        ? visibleFirst("#container .store-card") || visibleFirst("#dsServiceChips .ds-svc")
        : pageId === "delivery"
          ? visibleFirst("#dsServiceChips .ds-svc")
          : visibleFirst(".store-card:not(.stores-grid--skeleton .store-card)") ||
            visibleFirst("#container .store-card") ||
            visibleFirst(".store-card");
    var firstCardRect = firstCard ? firstCard.getBoundingClientRect() : null;
    var scrollToFirst = firstCardRect
      ? Math.max(0, Math.ceil(firstCardRect.top - 56))
      : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      header: rect(".dash-site-header"),
      hero: rect(".guest-section-hero"),
      search: rect(".stores-search-wrap"),
      sortBar: rect("#hubSortBar, .erv-section-hub__sort"),
      countLine: rect("#hubCountLine"),
      categoryBlock: rect("#storesRestaurantCuisineBlock, #storesCategoryBlock"),
      guestNote: rect("#guestNote"),
      breadcrumb: rect(".ds-crumb"),
      quicklinks: rect(".ds-quicklinks"),
      deliveryPicker: rect("#dsServicePickerSection"),
      deliveryForm: rect(".ds-form-zone"),
      svcOrderPanel: rect("#svcOrderPanel"),
      firstResult: firstCard
        ? {
            tag: firstCard.tagName + (firstCard.className ? "." + String(firstCard.className).split(" ")[0] : ""),
            top: Math.round(firstCardRect.top),
            bottom: Math.round(firstCardRect.bottom),
            visibleWithoutScroll: firstCardRect.top >= 0 && firstCardRect.top < window.innerHeight,
            visiblePct: firstCardRect.height
              ? Math.round(
                  (Math.min(firstCardRect.bottom, window.innerHeight) - Math.max(firstCardRect.top, 0)) /
                    firstCardRect.height *
                    100
                )
              : 0,
          }
        : null,
      scrollPxToFirstResult: scrollToFirst,
      chromeAboveResults: sumHeights([
        ".dash-site-header",
        ".guest-section-hero",
        ".stores-toolbar",
        ".stores-search-wrap",
        "#hubSortBar",
        "#hubCountLine",
        "#storesRestaurantCuisineBlock",
        "#storesCategoryBlock",
        "#guestNote",
        ".ds-crumb",
        ".ds-quicklinks",
        "#dsServicePickerSection .ds-section-block__hint",
        "#svcOrderPanel",
      ]),
    };
  }, cfg.id);
}

async function measureTimeToFirstResult(page, cfg) {
  const t0 = Date.now();
  await cfg.waitForResult(page);
  const firstVisible = await page.evaluate(function (sel) {
    var el = document.querySelector(sel);
    if (!el) {
      el = document.querySelector(".store-card, #dsServiceChips .ds-svc, .erv-section-hub__empty");
    }
    if (!el) return { found: false };
    var r = el.getBoundingClientRect();
    return {
      found: true,
      top: Math.round(r.top),
      visible: r.height > 0 && r.bottom > 0,
      text: (el.textContent || "").trim().slice(0, 60),
    };
  }, cfg.firstResultSel);
  return { ms: Date.now() - t0, firstVisible };
}

async function measureClickPath(page, cfg) {
  return page.evaluate(function (args) {
    var actionSel = args.actionSel;
    var path = [];
    var clicks = 0;

    function first(sel) {
      var list = sel.split(",").map(function (s) {
        return s.trim();
      });
      for (var i = 0; i < list.length; i++) {
        var el = document.querySelector(list[i]);
        if (el && el.offsetParent !== null && !el.disabled && !el.hidden) return el;
      }
      return null;
    }

    var scrollNeeded = 0;
    var target = first(actionSel) || first(".store-card .store-card__btn") || first("#dsServiceChips .ds-svc:not(.is-soon)");
    if (target) {
      var r = target.getBoundingClientRect();
      if (r.top > window.innerHeight - 80) {
        scrollNeeded = Math.ceil(r.top - 120);
        path.push("تمرير ~" + scrollNeeded + "px للوصول للعنصر");
      }
    }

    if (args.id === "delivery") {
      path.push("0: دخول الصفحة — رؤية شرائح الخدمات");
      clicks = 1;
      path.push("1: نقرة — اختيار نوع التوصيل (ds-svc)");
      path.push("2: تمرير/قراءة — نموذج «أكمل تفاصيل الطلب»");
      path.push("3+: نقرة — تعبئة الحقول وإرسال");
      return { minClicksToAction: clicks, scrollPx: scrollNeeded, path: path, note: "الحد الأدنى لبدء الطلب = 1 نقرة على الخدمة" };
    }

    if (args.id === "services") {
      path.push("0: دخول — بحث + تصنيفات + شبكة مقدّمين (لوحة الطلب في sheet)");
      var hasGrid = !!document.querySelector("#container .store-card .store-card__btn");
      if (hasGrid) {
        clicks = 1;
        path.push("1: نقرة — «تصفح/احجز» على أول مقدّم → فتح sheet الطلب");
        path.push("2: تعبئة النموذج + إرسال");
      } else {
        path.push("1: لا مقدّمين — لا يمكن النقر");
      }
      return {
        minClicksToAction: clicks || 0,
        scrollPx: scrollNeeded,
        path: path,
        note: "مسار واحد: مقدّم → sheet → إرسال",
      };
    }

    path.push("0: دخول — Hero + بحث + 3 فلاتر + تصنيفات + نص زائر");
    if (target) {
      clicks = 1;
      path.push("1: نقرة — «تصفح/اطلب» على أول بطاقة");
    } else {
      path.push("1: لا نتائج — لا يمكن النقر");
    }
    return {
      minClicksToAction: clicks,
      scrollPx: scrollNeeded,
      path: path,
      note: scrollNeeded > 0 ? "يتطلب تمرير قبل النقر" : "النتيجة قد تكون ظاهرة دون تمرير",
    };
  }, { id: cfg.id, actionSel: cfg.actionSel });
}

async function auditPage(browser, cfg) {
  const page = await browser.newPage();
  await page.setViewportSize(VIEWPORT);
  const navStart = Date.now();
  try {
    await page.goto(BASE + cfg.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) {
    await page.goto(BASE + cfg.url, { timeout: 45000 }).catch(() => {});
  }
  const domReadyMs = Date.now() - navStart;

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, cfg.id + "-first-paint-390.png"), fullPage: false });

  const timeResult = await measureTimeToFirstResult(page, cfg);
  const layout = await measureLayout(page, cfg);
  const clicks = await measureClickPath(page, cfg);

  await page.screenshot({ path: path.join(OUT, cfg.id + "-loaded-390.png"), fullPage: false });
  await page.screenshot({ path: path.join(OUT, cfg.id + "-full-390.png"), fullPage: true });

  await page.close();

  return {
    id: cfg.id,
    url: cfg.url,
    label: cfg.label,
    domReadyMs,
    timeToFirstResultMs: timeResult.ms,
    firstVisible: timeResult.firstVisible,
    layout,
    clicks,
    screenshots: {
      firstPaint: cfg.id + "-first-paint-390.png",
      loaded: cfg.id + "-loaded-390.png",
      full: cfg.id + "-full-390.png",
    },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const cfg of PAGES) {
    console.log("Auditing", cfg.id, "...");
    const r = await auditPage(browser, cfg);
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }
  await browser.close();

  const report = {
    capturedAt: new Date().toISOString(),
    phase: phase === "before" ? "before" : "after",
    viewport: VIEWPORT,
    goal: "تقليل زمن الوصول للخدمة 50%+",
    results,
  };
  const jsonPath = path.join(OUT, "audit-metrics.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log("Saved", jsonPath);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
