const fs = require("fs");
const path = require("path");

describe("P0-02 /api/admin/* auth scan", () => {
  test("admin/settings router applies requireAuth + requireRole(admin) globally", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/admin/settings.js"), "utf8");
    expect(src).toMatch(/router\.use\(\s*requireAuth\s*,\s*requireRole\(\s*["']admin["']\s*\)\s*\)/);
  });

  test("only job-applications/public is unauthenticated in admin routes", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/admin/routes.js"), "utf8");
    const re = /router\.(get|post|put|patch|delete)\(\s*\n?\s*["']([^"']+)["']/g;
    const missing = [];
    let m;
    while ((m = re.exec(src))) {
      const routePath = m[2];
      if (routePath === "/job-applications/public") continue;
      const window = src.slice(m.index, m.index + 480);
      if (!/requireAuth/.test(window)) missing.push(routePath);
    }
    expect(missing).toEqual([]);
  });
});
