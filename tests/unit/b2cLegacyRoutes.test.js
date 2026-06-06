const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "../../public");

const FORBIDDEN_PATTERNS = [
  { re: /\/api\/checkout(?!-payment-methods)/, label: "POST /api/checkout" },
  { re: /\/api\/food\/orders/, label: "/api/food/orders" },
  { re: /\/api\/delivery\/create/, label: "/api/delivery/create" },
  { re: /\/api\/delivery\/orders/, label: "/api/delivery/orders" },
];

const B2C_SKIP = new Set([
  "admin",
  "driver",
  "admin-dashboard.html",
  "driver.html",
  "driver-app.html",
  "driver-wallet.html",
  "driver-login.html",
  "driver-register.html",
]);

function walkPublicFiles(dir, relBase, acc) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = relBase ? path.join(relBase, name) : name;
    if (fs.statSync(abs).isDirectory()) {
      if (B2C_SKIP.has(name)) continue;
      walkPublicFiles(abs, rel, acc);
      continue;
    }
    if (!/\.(html|js)$/.test(name)) continue;
    if (B2C_SKIP.has(name) || B2C_SKIP.has(rel.replace(/\\/g, "/"))) continue;
    acc.push({ abs, rel: rel.replace(/\\/g, "/") });
  }
  return acc;
}

describe("B2C legacy order routes", () => {
  test("customer-facing public files do not reference legacy order API paths", () => {
    const files = walkPublicFiles(PUBLIC_DIR, "", []);
    const violations = [];

    for (const file of files) {
      const text = fs.readFileSync(file.abs, "utf8");
      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.re.test(text)) {
          violations.push(`${file.rel} → ${rule.label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("cart checkout uses unified POST /api/order/create", () => {
    const cartJs = fs.readFileSync(path.join(PUBLIC_DIR, "assets/cart.js"), "utf8");
    expect(cartJs).toMatch(/\/api\/order\/create/);
    expect(cartJs).not.toMatch(/\/api\/checkout[^\-]/);
    expect(cartJs).not.toMatch(/\/api\/delivery\/create/);
    expect(cartJs).not.toMatch(/\/api\/food\/orders/);
  });
});
