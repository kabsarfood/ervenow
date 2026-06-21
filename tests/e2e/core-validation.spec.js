/**
 * ERVENOW Core Validation — Portal E2E (mocked APIs + UI smoke)
 * Captures screenshots to docs/validation-screenshots/
 */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const SHOT_DIR = path.join(__dirname, "..", "..", "docs", "validation-screenshots");

const MOCK_STORE_USER = {
  id: "val-store-1",
  phone: "0599999901",
  role: "store",
  status: "approved",
};

const MOCK_DRIVER_USER = {
  id: "val-driver-1",
  phone: "0599999902",
  role: "driver",
  status: "approved",
};

const MOCK_SERVICE_USER = {
  id: "val-service-1",
  phone: "0599999903",
  role: "service",
  status: "approved",
  service_type: "plumber",
};

const MOCK_TRANSPORT_USER = {
  id: "val-transport-1",
  phone: "0599999904",
  role: "service",
  status: "approved",
  service_type: "pickup_truck",
};

function ensureShotDir() {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
}

async function shot(page, name) {
  ensureShotDir();
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
}

async function installPortalMocks(page, profile) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(url)) {
      return route.fulfill({ status: 200, contentType: "text/css", body: "/* e2e */" });
    }
    return route.continue();
  });

  const role = String(profile.role || "customer").toLowerCase();
  const notifications = [
    {
      id: "n-order-new",
      title: "طلب جديد",
      message: "طلب #E2E-1001 بانتظار التجهيز",
      type: "order",
      source: "ervenow",
      payload: { event: "merchant.order.new", target_portal: "merchant", order_id: "ord-1" },
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: "n-withdraw-ok",
      title: "تم اعتماد السحب",
      message: "تمت الموافقة على طلب السحب",
      type: "wallet",
      source: "wallet",
      payload: { event: "merchant.withdraw.approved", target_portal: "merchant" },
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ];

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method().toUpperCase();

    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (p.endsWith("/api/health")) return json({ ok: true, service: "core" });

    if (p.endsWith("/api/core/me")) {
      return json({
        ok: true,
        approved: true,
        user: { id: profile.id, phone: profile.phone },
        profile: Object.assign({}, profile, { status: profile.status || "active" }),
        access: { can_place_orders: true, role: profile.role },
      });
    }

    if (p.endsWith("/api/core/readiness-beacon")) return json({ ok: true });
    if (p.includes("/api/core/site-maintenance")) return json({ ok: true, maintenance: false });

    if (p.endsWith("/api/core/platform-modules")) {
      return json({
        ok: true,
        modules: {
          ervenow_pos: { id: "ervenow_pos", status: "disabled" },
          service_schedule: { id: "service_schedule", status: "enabled" },
          transport_fleet: { id: "transport_fleet", status: "enabled" },
          transport_pricing: { id: "transport_pricing", status: "enabled" },
        },
      });
    }

    if (p.endsWith("/api/notifications/unread-count")) return json({ ok: true, unread_count: 2 });
    if (p.endsWith("/api/notifications")) return json({ ok: true, items: notifications });

    if (role === "store" && p.endsWith("/api/store/my-store")) {
      return json({
        ok: true,
        store: { id: "store-val-1", name: "مطعم التحقق", status: "approved", type: "restaurant" },
        merchant_hub: { bio: "E2E" },
      });
    }
    if (role === "store" && p.endsWith("/api/store/merchant-dashboard")) {
      return json({
        ok: true,
        wallet: { balance: 500, total_earned: 1200, total_commission: 50 },
        orders: [{ id: "ord-1", order_number: "E2E-1001", delivery_status: "pending", order_total: 85 }],
        transactions: [{ created_at: new Date().toISOString(), description: "بيع", amount: 85 }],
      });
    }
    if (role === "store" && p.endsWith("/api/store/order-board")) {
      return json({
        ok: true,
        orders: [{ id: "ord-1", order_number: "E2E-1001", delivery_status: "pending", order_total: 85 }],
        status_counts: { pending: 1 },
      });
    }
    if (role === "store" && p.includes("/api/store/products")) {
      return json({ ok: true, products: [{ id: "p1", name: "وجبة", price: 45, category: "main" }], total: 1 });
    }
    if (role === "store" && p.endsWith("/api/store/product-category-options")) {
      return json({ ok: true, options: [{ slug: "main", label: "رئيسي", value: "main" }] });
    }
    if (role === "store" && p.endsWith("/api/store/merchant-categories")) {
      return json({
        ok: true,
        categories: [{ slug: "main", label: "رئيسي", icon: "🍽", product_count: 3, sort_order: 0, is_builtin: false }],
      });
    }
    if (role === "store" && p.endsWith("/api/store/withdrawals")) {
      return json({
        ok: true,
        balance: 500,
        available: 450,
        pending_reserved: 50,
        total_withdrawn: 200,
        portal_type: "merchant",
        withdrawals: [
          {
            id: "wd-val-001",
            amount: 100,
            status: "pending",
            created_at: new Date().toISOString(),
          },
        ],
      });
    }

    if (role === "driver" && p.endsWith("/api/driver/orders")) {
      return json({
        ok: true,
        ready_queue: [{ id: "ord-1", order_number: "E2E-D1", delivery_status: "ready", order_total: 85 }],
        active: [],
        completed: [],
        orders: [],
      });
    }
    if (role === "driver" && p.endsWith("/api/driver/wallet")) {
      return json({ ok: true, balance: 120, total_earned: 800, total_withdrawn: 100, last_transactions: [] });
    }
    if (role === "driver" && p.endsWith("/api/driver/earnings")) {
      return json({
        ok: true,
        today: { earnings_sar: 45, trips: 2, avg_per_trip_sar: 22.5 },
        week: { earnings_sar: 180, trips: 8, avg_per_trip_sar: 22.5 },
        month: { earnings_sar: 720, trips: 32, avg_per_trip_sar: 22.5 },
      });
    }
    if (role === "driver" && p.endsWith("/api/driver/rating")) {
      return json({ ok: true, avg: 4.8, count: 12 });
    }

    if (p.endsWith("/api/services/me/dashboard")) {
      const isTransport = profile.service_type === "pickup_truck";
      return json({
        ok: true,
        panel_title: isTransport ? "لوحة النقل" : "لوحة الخدمة",
        service_label: isTransport ? "نقل" : "سباك",
        profile,
        bookings: [
          {
            id: "bk-1",
            service_name: isTransport ? "سطحة" : "سباك",
            status: "new",
            service_type: isTransport ? "pickup_truck" : "plumber",
            total_amount: 150,
            created_at: new Date().toISOString(),
            scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
        portal_type: isTransport ? "transport" : "service",
        stats: {
          new_orders: 1,
          active_jobs: 0,
          completed_jobs: 5,
          wallet_balance_sar: 300,
          wallet_earned_sar: 900,
          wallet_earned_today_sar: 75,
          rating_avg: 4.6,
          rating_count: 8,
        },
      });
    }
    if (p.endsWith("/api/services/me/schedule")) {
      const bk = {
        id: "bk-1",
        service_name: "موعد",
        status: "new",
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      };
      return json({ ok: true, today: [bk], week: [bk], all: [bk] });
    }
    if (p.endsWith("/api/services/me/fleet")) {
      return json({
        ok: true,
        vehicles: [{ type: "flatbed", plate: "أ ب ج 1234", status: "available", driver_name: "سائق" }],
        activity: [],
      });
    }
    if (p.endsWith("/api/services/me/pricing")) {
      return json({
        ok: true,
        gas: { cylinder_one: 38, cylinder_two: 76, central_per_liter: 1 },
        samples: [{ label: "نقل 10كم", fee: 120 }],
      });
    }
    if (p.endsWith("/api/wallet/transactions")) {
      return json({ ok: true, transactions: [{ created_at: new Date().toISOString(), amount: 50, type: "earning" }] });
    }

    return json({ ok: true });
  });
}

async function seedToken(page, profile) {
  await page.addInitScript((p) => {
    window.__CORE_VALIDATION_PROFILE__ = p;
    localStorage.setItem("ervenow_access_token", "core-validation-token");
    localStorage.setItem("token", "core-validation-token");
    try {
      var orig = window.location.replace.bind(window.location);
      window.location.replace = function (url) {
        if (String(url || "").indexOf("/login") >= 0 || String(url || "").indexOf("pending-approval") >= 0) return;
        return orig(url);
      };
    } catch (_e) {}
  }, profile);
}

async function stubAuthGuard(page) {
  await page.route("**/auth-account-guard.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `(function (global) {
  function isApprovedMe(me) { return !!(me && me.approved !== false); }
  async function ensureApprovedAccount() {
    if (!global.PlatformAPI || !global.PlatformAPI.getToken || !global.PlatformAPI.getToken()) return null;
    var profile = global.__CORE_VALIDATION_PROFILE__ || { role: "customer", status: "active" };
    return { approved: true, profile: profile };
  }
  function clearSession() {
    try {
      if (global.PlatformAPI && global.PlatformAPI.setToken) global.PlatformAPI.setToken("");
      localStorage.removeItem("ervenow_access_token");
      localStorage.removeItem("token");
    } catch (_e) {}
  }
  global.ErvenowAuthGuard = { ensureApprovedAccount: ensureApprovedAccount, clearSession: clearSession, isApprovedMe: isApprovedMe };
})(typeof window !== "undefined" ? window : global);`,
    })
  );
}

async function waitPortalReady(page, appSel) {
  await page.waitForFunction(
    (sel) => {
      var app = document.querySelector(sel);
      if (!app) return false;
      return !!app.querySelector(".pf-shell, [data-pf-main]");
    },
    appSel,
    { timeout: 25000 }
  );
  await expect(page.locator(appSel).locator(".pf-shell, [data-pf-main]").first()).toBeVisible({ timeout: 5000 });
}

test.describe("ERVENOW Core Validation — Merchant", () => {
  test("merchant portal sections load with mocked data", async ({ page }) => {
    await installPortalMocks(page, MOCK_STORE_USER);
    await stubAuthGuard(page);
    await seedToken(page, MOCK_STORE_USER);
    await page.goto("/merchant-preview", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#mpApp");
    await shot(page, "merchant-dashboard.png");

    await page.goto("/merchant-preview#orders", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#mpApp");
    await expect(page.locator("text=الطلبات").first()).toBeVisible();
    await shot(page, "merchant-orders.png");

    await page.goto("/merchant-preview#categories", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#mpApp");
    await expect(page.locator("text=جميع الفئات").first()).toBeVisible();
    await shot(page, "merchant-categories.png");

    await page.goto("/merchant-preview#withdrawals", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#mpApp");
    await expect(page.locator("text=آخر عمليات السحب").first()).toBeVisible();
    await shot(page, "merchant-withdrawals.png");

    await page.goto("/merchant-preview#notifications", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#mpApp");
    await expect(page.locator(".erv-notif-page, .mp-notif-host").first()).toBeVisible({ timeout: 15000 });
    await shot(page, "merchant-notifications.png");
  });
});

test.describe("ERVENOW Core Validation — Driver", () => {
  test("driver portal sections load with mocked data", async ({ page }) => {
    await installPortalMocks(page, MOCK_DRIVER_USER);
    await stubAuthGuard(page);
    await seedToken(page, MOCK_DRIVER_USER);
    await page.goto("/driver-preview", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#dpApp");
    await shot(page, "driver-dashboard.png");

    await page.goto("/driver-preview#earnings", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#dpApp");
    await expect(page.locator("text=الأرباح").first()).toBeVisible();
    await shot(page, "driver-earnings.png");

    await page.goto("/driver-preview#wallet", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#dpApp");
    await expect(page.locator("text=المحفظة").first()).toBeVisible();
    await shot(page, "driver-wallet.png");

    await page.goto("/driver-preview#notifications", { waitUntil: "domcontentloaded" });
    await waitPortalReady(page, "#dpApp");
    await expect(page.locator(".erv-notif-page, .dp-notif-host, #dpApp").first()).toBeVisible();
    await shot(page, "driver-notifications.png");
  });
});

test.describe("ERVENOW Core Validation — Service", () => {
  test("service portal sections load with mocked data", async ({ page }) => {
    await installPortalMocks(page, MOCK_SERVICE_USER);
    await stubAuthGuard(page);
    await seedToken(page, MOCK_SERVICE_USER);
    await page.goto("/service-preview", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#spApp")).toBeVisible({ timeout: 20000 });
    await shot(page, "service-dashboard.png");

    await page.goto("/service-preview#schedule", { waitUntil: "domcontentloaded" });
    await expect(page.locator("text=اليوم").first()).toBeVisible({ timeout: 15000 });
    await shot(page, "service-schedule.png");
  });
});

test.describe("ERVENOW Core Validation — Transport", () => {
  test("transport portal sections load with mocked data", async ({ page }) => {
    await installPortalMocks(page, MOCK_TRANSPORT_USER);
    await stubAuthGuard(page);
    await seedToken(page, MOCK_TRANSPORT_USER);
    await page.goto("/transport-preview", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#tpApp")).toBeVisible({ timeout: 20000 });
    await shot(page, "transport-dashboard.png");

    await page.goto("/transport-preview#fleet", { waitUntil: "domcontentloaded" });
    await expect(page.locator("text=الأسطول").first()).toBeVisible({ timeout: 15000 });
    await shot(page, "transport-fleet.png");

    await page.goto("/transport-preview#pricing", { waitUntil: "domcontentloaded" });
    await expect(page.locator("text=التسعير").first()).toBeVisible({ timeout: 15000 });
    await shot(page, "transport-pricing.png");
  });
});
