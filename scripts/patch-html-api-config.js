/**
 * يضيف تحميل api-config.js قبل api.js في صفحات public/*.html
 */
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "..", "public");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.name.endsWith(".html")) {
      let s = fs.readFileSync(full, "utf8");
      if (s.includes("api-config.js")) continue;
      const re = /<script\s+src="\/assets\/api\.js"\s*>\s*<\/script>/g;
      if (!re.test(s)) continue;
      s = s.replace(
        /<script\s+src="\/assets\/api\.js"\s*>\s*<\/script>/g,
        '<script src="/assets/api-config.js"></script>\n    <script src="/assets/api.js"></script>'
      );
      fs.writeFileSync(full, s);
      console.log("patched:", path.relative(publicDir, full));
    }
  }
}

walk(publicDir);
