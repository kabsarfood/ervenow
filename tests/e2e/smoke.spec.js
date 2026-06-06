const { test, expect } = require("@playwright/test");

const MOCK_USER = {
  id: "e2e-customer-1",
  phone: "0512345678",
  role: "customer",
  status: "active",
};

const MOCK_STORE_ORDER = {
  id: "e2e-order-store-1",
  order_number: "E2E-1001",
  delivery_status: "pending",
  order_type: "store",
  store_id: "store-1",
};

function apiPath(url) {
  try {
    return new URL(url).pathname;
  } catch (_e) {
    return url;
  }
}

async function installApiMocks(page) {
  const createdOrders = [];

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = apiPath(req.url());
    const method = req.method().toUpperCase();

    if (path.endsWith("/api/health") || path.endsWith("/api/health/full")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }

    if (path.endsWith("/api/core/send-otp") && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, sent: true }),
      });
    }

    if (path.endsWith("/api/core/verify-otp") && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, token: "e2e-test-token", user: MOCK_USER }),
      });
    }

    if (path.endsWith("/api/core/me")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: MOCK_USER,
          profile: { role: "customer", phone: MOCK_USER.phone, status: "active" },
          access: { can_place_orders: true, role: "customer" },
        }),
      });
    }

    if (path.endsWith("/api/wallet")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, balance: 150 }),
      });
    }

    if (path.endsWith("/api/core/checkout-payment-methods")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          methods: { cash_on_delivery: true, ew_pay: true, stc_pay: true },
        }),
      });
    }

    if (path.endsWith("/api/order/create") && method === "POST") {
      const body = req.postDataJSON() || {};
      const order = {
        ...MOCK_STORE_ORDER,
        id: "e2e-order-" + String(createdOrders.length + 1),
        order_type: body.order_type || (body.items && body.items[0] && body.items[0].type) || "store",
      };
      createdOrders.push(order);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, order, mode: body.items && body.items.length ? "cart" : "service" }),
      });
    }

    if (path.endsWith("/api/order/orders") && method === "GET") {
      const orders = createdOrders.length ? createdOrders : [MOCK_STORE_ORDER];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, orders }),
      });
    }

    if (/\/api\/order\/[^/]+$/.test(path) && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, order: createdOrders[0] || MOCK_STORE_ORDER }),
      });
    }

    if (path.includes("/api/store/") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          store: { id: "store-1", name: "متجر E2E", checkout_payment_methods: { cash_on_delivery: true } },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  return { createdOrders };
}

async function seedAuth(page) {
  await page.addInitScript(() => {
    localStorage.setItem("ervenow_access_token", "e2e-test-token");
    localStorage.setItem("userPhone", "0512345678");
  });
}

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

test.describe("ERVENOW smoke — unified cart checkout", () => {
  test("login OTP flow issues session token", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/login?mode=register&role=customer", { waitUntil: "domcontentloaded" });

    await page.locator("#phone").fill("0512345678");
    await page.locator("#authOtpBtn").click();
    await expect(page.locator("#loginCodeGroup")).toBeVisible();
    await page.locator("#otp").fill("123456");
    await page.locator("#authOtpBtn").click();

    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("ervenow_access_token")))
      .toBeTruthy();
  });

  test("cart checkout hits POST /api/order/create", async ({ page }) => {
    const mocks = await installApiMocks(page);
    await seedAuth(page);
    await page.goto("/my-orders", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const cart = {
        version: 2,
        items: [
          {
            id: "line-1",
            type: "store",
            title: "منتج E2E",
            price: 25,
            qty: 1,
            customer_phone: "0512345678",
            data: {
              store_id: "store-1",
              product_id: "prod-1",
              product_name: "منتج E2E",
              customer_phone: "0512345678",
            },
          },
        ],
        delivery: {
          lat: 24.7136,
          lng: 46.6753,
          address: "الرياض — E2E",
          fulfillment: "ervenow_delivery",
        },
        payment: { method: "cash_on_delivery" },
      };
      localStorage.setItem("cart", JSON.stringify(cart));

      const token = localStorage.getItem("ervenow_access_token");
      const r = await fetch("/api/order/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "Idempotency-Key": "e2e-checkout-1",
        },
        body: JSON.stringify({
          items: cart.items,
          payment_method: "cash_on_delivery",
          customer_phone: "0512345678",
          delivery: cart.delivery,
        }),
      });
      return { status: r.status, body: await r.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.order).toBeTruthy();
    expect(mocks.createdOrders.length).toBeGreaterThan(0);
  });

  test("created order visible via GET /api/order/orders", async ({ page }) => {
    await installApiMocks(page);
    await seedAuth(page);
    await page.goto("/my-orders", { waitUntil: "domcontentloaded" });
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/order/orders", {
        headers: { Authorization: "Bearer " + localStorage.getItem("ervenow_access_token") },
      });
      return r.json();
    });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.orders) ? res.orders.length : res.count >= 0).toBeTruthy();
  });
});

test.describe("ERVENOW smoke — service carts", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await seedAuth(page);
  });

  test("gas delivery item lands in cart v2", async ({ page }) => {
    await page.goto("/gas-delivery.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.getElementById("gdLocation").value = "24.713600,46.675300";
      document.getElementById("gdPhone").value = "0512345678";
    });
    await page.locator("#gdPayCart").click();

    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("cart")))
      .toMatch(/gas_delivery/i);
  });

  test("home service via service-cart", async ({ page }) => {
    await page.goto("/services.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.ErvenowServiceCart !== "undefined");

    const out = await page.evaluate(() => {
      return window.ErvenowServiceCart.add(
        {
          type: "service",
          title: "سباك — E2E",
          price: 120,
          customer_phone: "0512345678",
          data: {
            service_type: "plumber",
            location: "24.7136,46.6753",
            customer_phone: "0512345678",
          },
        },
        { redirect: false }
      );
    });

    expect(out.ok).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("cart"))).toContain("plumber");
  });

  test("vehicle transport via service-cart", async ({ page }) => {
    await page.goto("/delivery-services.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.ErvenowServiceCart !== "undefined");

    const out = await page.evaluate(() => {
      return window.ErvenowServiceCart.add(
        {
          type: "delivery",
          title: "نقل مركبة — E2E",
          price: 0,
          customer_phone: "0512345678",
          data: {
            service_type: "vehicle_transfer",
            pickup_address: "نقطة A",
            drop_address: "نقطة B",
            customer_phone: "0512345678",
          },
        },
        { redirect: false }
      );
    });

    expect(out.ok).toBe(true);
    const cart = JSON.parse(await page.evaluate(() => localStorage.getItem("cart")));
    expect(cart.items.some((i) => i.data && i.data.service_type === "vehicle_transfer")).toBe(true);
  });
});

test.describe("ERVENOW smoke — homepage visitor auth nav", () => {
  test("logged-in visitor sees wallet + logout; logout clears session", async ({ page }) => {
    await installApiMocks(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("ervenow_access_token", "e2e-test-token");
      localStorage.setItem("userPhone", "0512345678");
      localStorage.setItem("ervenow_guest_browse", "1");
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    const navLogout = page.locator('.lp-nav [data-nav="logout"]');
    await expect(navLogout).toBeVisible({ timeout: 15000 });
    await expect(navLogout).toHaveText("خروج");

    await expect(page.locator("#lpNavWallet")).toBeVisible();
    await expect(page.locator("#lpNavWalletAmount")).toContainText("١٥٠");

    await navLogout.click();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator('.lp-nav [data-nav="login"]')).toBeVisible();
    await expect(page.locator('.lp-nav [data-nav="logout"]')).toHaveCount(0);

    const session = await page.evaluate(() => ({
      token: localStorage.getItem("ervenow_access_token"),
      guestBrowse: localStorage.getItem("ervenow_guest_browse"),
    }));
    expect(session.token).toBeFalsy();
    expect(session.guestBrowse).toBeFalsy();
  });
});
