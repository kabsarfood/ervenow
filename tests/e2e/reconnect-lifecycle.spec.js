/**
 * G1-R — E2E lifecycle (mocked backend) — member → merchant → driver → settlement
 */
const { test, expect } = require("@playwright/test");

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

test.describe("G1-R reconnect lifecycle (mocked)", () => {
  test("merchant order workflow uses unified PATCH API", async ({ page }) => {
    const patches = [];
    await page.route("**/api/store/my-store", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          store: { id: "s1", name: "Test Store", average_rating: 4.5 },
          merchant_hub: { bio: "bio" },
        }),
      })
    );
    await page.route("**/api/store/merchant-dashboard", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          wallet: { balance: 100 },
          transactions: [],
          orders: [],
        }),
      })
    );
    await page.route("**/api/store/order-board", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          orders: [
            {
              id: "o1",
              order_number: "ED-001",
              delivery_status: "pending",
              board_status: "pending",
              total: 50,
              payment_status: "paid",
            },
          ],
          status_counts: { pending: 1 },
        }),
      })
    );
    await page.route("**/api/order/o1/status", (route) => {
      patches.push(route.request().method());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, order: { id: "o1", delivery_status: "accepted" } }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("erv_token", "test-token");
      window.PlatformAPI = {
        getToken: () => "test-token",
        api: async (url, opts) => {
          const res = await fetch(url, {
            headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
            method: (opts && opts.method) || "GET",
            body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
          });
          return res.json();
        },
      };
    });

    await page.goto(BASE + "/merchant-preview#orders");
    await page.waitForSelector(".mp-order-action", { timeout: 15000 });
    await page.click(".mp-order-action");
    await page.waitForTimeout(500);
    expect(patches).toContain("PATCH");
  });

  test("role-routing sends merchant to merchant-preview when live", async ({ page }) => {
    await page.goto(BASE + "/assets/role-routing.js");
    const live = await page.evaluate(() => window.ErvenowRoleRouting.PORTAL_LIVE.merchant);
    const path = await page.evaluate(() =>
      window.ErvenowRoleRouting.portalPathForRole("merchant")
    );
    expect(live).toBe(true);
    expect(path).toBe("/merchant-preview");
  });
});
