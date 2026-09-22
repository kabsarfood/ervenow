const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

describe("customer /dashboard retired", () => {
  test("dashboard.html is gone", () => {
    expect(fs.existsSync(path.join(PUBLIC, "dashboard.html"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "ervenow-frontend", "dashboard.html"))).toBe(false);
  });

  test("live customer HTML/JS does not href /dashboard", () => {
    const files = walk(PUBLIC, []).filter((f) => /\.(html|js)$/i.test(f));
    const hits = [];
    for (const file of files) {
      const rel = path.relative(PUBLIC, file).replace(/\\/g, "/");
      if (/admin\/modules\/dashboard\.js$|admin-dashboard\.js$|service-preview\.js$|transport-preview\.js$/.test(rel)) {
        continue;
      }
      const s = fs.readFileSync(file, "utf8");
      const re = /href=["']\/dashboard(?:\.html)?(?:#[^"']*)?["']/;
      if (re.test(s)) hits.push(rel);
      if (/"\/dashboard"/.test(s) && /href:\s*"\/dashboard"/.test(s)) hits.push(rel + " href:");
    }
    expect(hits).toEqual([]);
  });

  test("guest-shell no longer offers a /dashboard nav item", () => {
    const js = fs.readFileSync(path.join(PUBLIC, "assets/guest-shell.js"), "utf8");
    expect(js).not.toMatch(/href:\s*"\/dashboard"/);
    expect(js).not.toMatch(/key:\s*"guest".*\/dashboard/);
  });
});
