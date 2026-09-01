const fs = require("fs");
const path = require("path");

describe("P1-07 / P1-08 ownership and service-role boundary", () => {
  test("GET /api/order/:id checks customer, driver, merchant, service ownership", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/order/routes.js"), "utf8");
    expect(src).toMatch(/o\.customer_id !== req\.appUser\.id/);
    expect(src).toMatch(/merchantOwnsOrder/);
    expect(src).toMatch(/getOrderProviderId/);
    expect(src).toMatch(/Forbidden/);
  });

  test("wallet ledger/pay uses server order amount and customer_id", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/wallet/routes.js"), "utf8");
    const payIdx = src.indexOf('router.post("/ledger/pay"');
    expect(payIdx).toBeGreaterThan(-1);
    const snippet = src.slice(payIdx, payIdx + 1200);
    expect(snippet).toMatch(/orderChargeAmount\(order\)/);
    expect(snippet).toMatch(/order\.customer_id/);
  });

  test("notifications routes requireAuth", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/notifications/routes.js"), "utf8");
    expect(src).toMatch(/router\.get\("\/", requireAuth/);
  });

  test("home-order / gas-order / services checkout require auth", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/services/routes.js"), "utf8");
    expect(src).toMatch(/router\.post\("\/home-order", requireAuth/);
    expect(src).toMatch(/router\.post\("\/gas-order", requireAuth/);
    expect(src).toMatch(/router\.post\("\/checkout", requireAuth/);
  });

  test("service role key is not in public bundles", () => {
    const publicDir = path.join(__dirname, "../../public");
    const hits = [];
    function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "uploads") continue;
          walk(p);
          continue;
        }
        if (!/\.(js|html)$/i.test(ent.name)) continue;
        const txt = fs.readFileSync(p, "utf8");
        if (/SUPABASE_SERVICE_ROLE_KEY|service_role_key/i.test(txt)) hits.push(p);
      }
    }
    walk(publicDir);
    expect(hits).toEqual([]);
  });
});
