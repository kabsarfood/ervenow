/**
 * Functional smoke test: delivery map page (links + map modes, mobile + desktop).
 * Usage: node scripts/test-map-modal-functional.js [baseUrl]
 */
const path = require("path");

const BASE = process.argv[2] || "http://127.0.0.1:4000";
const PICKUP = { lat: 24.6877, lng: 46.7219 };
const DROP = { lat: 24.758, lng: 46.805 };
const FROM_LINK = `https://www.google.com/maps?q=${PICKUP.lat},${PICKUP.lng}`;
const TO_LINK = `https://www.google.com/maps?q=${DROP.lat},${DROP.lng}`;
const PHONE = "0512345678";

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail: detail || "" });
  console.log("✓", name, detail ? `— ${detail}` : "");
}

function fail(name, detail) {
  results.push({ name, ok: false, detail: detail || "" });
  console.error("✗", name, detail ? `— ${detail}` : "");
}

async function openMapModal(page) {
  await page.goto(`${BASE}/delivery-map`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#pickupDropMap", { timeout: 20000 });
  await page.waitForFunction(() => typeof L !== "undefined" && typeof window.ErvenowDeliveryMap !== "undefined", {
    timeout: 20000,
  });
  await page.waitForTimeout(800);
}

async function readPricing(page) {
  return page.evaluate(() => {
    var price = document.getElementById("price");
    var dist = document.getElementById("distance");
    var btn = document.getElementById("createBtn");
    var result = document.getElementById("result");
    var st =
      typeof getDeliveryMapPageState === "function"
        ? getDeliveryMapPageState()
        : { hasRoute: false, km: 0, fromLL: null, toLL: null };
    return {
      price: price ? price.innerText.trim() : "",
      distance: dist ? dist.innerText.trim() : "",
      createEnabled: btn ? !btn.disabled : false,
      result: result ? result.innerText.trim() : "",
      hasRoute: !!st.hasRoute,
      km: st.km || 0,
      fromLL: st.fromLL || null,
      toLL: st.toLL || null,
    };
  });
}

async function waitForRoute(page, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await readPricing(page);
    if (s.km > 0 && s.price.includes("ر.س") && s.distance.includes("كم")) {
      return s;
    }
    await page.waitForTimeout(500);
  }
  return readPricing(page);
}

async function testLinksMode(page, viewportLabel) {
  const prefix = `[${viewportLabel}] روابط`;
  await openMapModal(page);
  await page.evaluate(() => setDeliveryMode("links"));
  await page.waitForTimeout(400);

  await page.fill("#fromLink", FROM_LINK);
  await page.fill("#toLink", TO_LINK);
  await page.fill("#mapSenderPhone", PHONE);
  await page.fill("#mapRecipientPhone", PHONE);

  await page.click("#btnApplyMapRoute");
  const state = await waitForRoute(page, prefix, 45000);

  if (state.km > 0) pass(`${prefix}: رسم المسار`, `${state.distance}`);
  else fail(`${prefix}: رسم المسار`, JSON.stringify(state));

  if (state.price.includes("ر.س")) pass(`${prefix}: السعر`, state.price);
  else fail(`${prefix}: السعر`, state.price);

  if (state.distance.includes("كم")) pass(`${prefix}: المسافة`, state.distance);
  else fail(`${prefix}: المسافة`, state.distance);

  const osrm = await page.evaluate(async () => {
    var st = typeof getDeliveryMapPageState === "function" ? getDeliveryMapPageState() : {};
    if (!st.fromLL || !st.toLL || typeof getRoute !== "function") return null;
    var r = await getRoute(st.fromLL, st.toLL);
    return { durationSec: r.duration, distanceM: r.distance };
  });
  if (osrm && osrm.durationSec > 0) {
    pass(`${prefix}: وقت OSRM`, `${Math.round(osrm.durationSec / 60)} دقيقة (داخلي)`);
  } else {
    fail(`${prefix}: وقت OSRM`, "لا duration من OSRM");
  }

  if (state.createEnabled) pass(`${prefix}: زر السلة مفعّل`);
  else fail(`${prefix}: زر السلة`, "معطّل");

  await page.evaluate(() => {
    window.__mapCartTest = [];
    if (window.ErvenowServiceCart && typeof ErvenowServiceCart.add === "function") {
      var origAdd = ErvenowServiceCart.add.bind(ErvenowServiceCart);
      ErvenowServiceCart.add = function (item, opts) {
        window.__mapCartTest.push(item);
        opts = opts || {};
        opts.redirect = false;
        return origAdd(item, opts);
      };
    }
  });

  await page.click("#createBtn");
  await page.waitForTimeout(3000);

  const cartItem = await page.evaluate(() => {
    var items = window.__mapCartTest || [];
    var it = items.length ? items[items.length - 1] : null;
    if (!it) {
      try {
        var cart = JSON.parse(localStorage.getItem("cart") || "[]");
        for (var i = cart.length - 1; i >= 0; i--) {
          var d = cart[i] && cart[i].data;
          if (d && d.source === "dashboard_map") {
            it = cart[i];
            break;
          }
        }
      } catch (e) {}
    }
    if (!it) return null;
    return {
      type: it.type,
      price: it.price,
      km: it.data && it.data.distance_km,
      hasPickup: !!(it.data && it.data.pickup_lat),
      hasDrop: !!(it.data && it.data.drop_lat),
    };
  });

  if (cartItem && cartItem.type === "delivery" && cartItem.price > 0 && cartItem.hasPickup && cartItem.hasDrop) {
    pass(`${prefix}: إضافة للسلة`, `${cartItem.price} ر.س / ${cartItem.km} كم`);
  } else {
    const res = await page.evaluate(() => (document.getElementById("result") || {}).innerText || "");
    fail(`${prefix}: إضافة للسلة`, res || JSON.stringify(cartItem));
  }
}

async function testMapMode(page, viewportLabel) {
  const prefix = `[${viewportLabel}] خريطة`;
  await openMapModal(page);
  await page.evaluate(() => setDeliveryMode("map"));
  await page.waitForTimeout(600);

  await page.evaluate(async ({ pickup, drop }) => {
    if (typeof initMap === "function") initMap();
    await new Promise(function (r) {
      setTimeout(r, 300);
    });
    if (typeof selectMode === "function") selectMode("from");
    await onMapClick({ latlng: { lat: pickup.lat, lng: pickup.lng } });
    if (typeof selectMode === "function") selectMode("to");
    await onMapClick({ latlng: { lat: drop.lat, lng: drop.lng } });
  }, { pickup: PICKUP, drop: DROP });

  const state = await waitForRoute(page, prefix, 45000);

  if (state.km > 0) pass(`${prefix}: رسم المسار`, state.distance);
  else fail(`${prefix}: رسم المسار`, JSON.stringify(state));

  if (state.price.includes("ر.س")) pass(`${prefix}: السعر`, state.price);
  else fail(`${prefix}: السعر`, state.price);

  if (state.createEnabled) pass(`${prefix}: زر السلة مفعّل`);
  else fail(`${prefix}: زر السلة معطّل`);
}

async function runViewport(browser, viewport, isMobile) {
  const ctx = await browser.newContext({
    viewport,
    locale: "ar-SA",
    isMobile: !!isMobile,
    hasTouch: !!isMobile,
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("ervenow_access_token", "test-map-functional-token");
    } catch (e) {}
    window.__mapCartTest = [];
  });
  const page = await ctx.newPage();
  const label = isMobile ? "جوال" : "سطح المكتب";
  try {
    await testLinksMode(page, label);
    await testMapMode(page, label);
  } finally {
    await ctx.close();
  }
}

async function main() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    console.error("Playwright required: npx playwright install chromium");
    process.exit(1);
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    await runViewport(browser, { width: 390, height: 844 }, true);
    await runViewport(browser, { width: 1280, height: 900 }, false);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n---");
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.error(`  FAIL: ${f.name} — ${f.detail}`));
    process.exit(1);
  }
  console.log("All functional checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
