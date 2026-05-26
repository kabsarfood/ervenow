/**
 * ينقل الفوتر خارج .layout ليطابق لوحة الزائر (عرض كامل الشاشة).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

const FILES = [
  "cart.html",
  "browse.html",
  "order.html",
  "track.html",
  "store.html",
  "gas-delivery.html",
  "careers.html",
  "start-now.html",
];

function fixFooter(html) {
  let out = html;

  // فوتر داخل .layout → خارجها
  out = out.replace(
    /(\n)([ \t]*)<footer class="dash-site-footer">([\s\S]*?)<\/footer>\n[ \t]*<\/div>\n[ \t]*<\/div>/g,
    (m, nl, indent, body) => {
      const inner = body.replace(/\n[ \t]{6}/g, "\n      ");
      return `${nl}      </div>${nl}${nl}    <footer class="dash-site-footer">${inner}</footer>${nl}    </div>`;
    }
  );

  // إزالة .layout المكرر الأول (cart, browse, order, track)
  out = out.replace(
    /<div class="dash-main">\s*\n\s*<div class="layout">\s*\n\s*<div class="layout/g,
    '<div class="dash-main">\n      <div class="layout'
  );
  out = out.replace(
    /<div class="dash-main">\s*\n\s*<div class="layout">\s*\n\s*<div id="trackSocketBanner"/g,
    '<div class="dash-main">\n    <div id="trackSocketBanner"'
  );
  out = out.replace(
    /<div class="dash-main">\s*\n\s*<div class="layout">\s*\n\s*<div class="layout browse-wrap"/g,
    '<div class="dash-main">\n      <div class="layout browse-wrap"'
  );

  // store: فوتر بعد السكربتات
  out = out.replace(
    /(<script src="\/assets\/cart\.js"><\/script>)\s*\n\s*<footer class="dash-site-footer">([\s\S]*?)<\/footer>\s*\n\s*<\/div>\s*\n\s*<\/div>/,
    `      </div>\n    </div>\n\n    <footer class="dash-site-footer">$2</footer>\n    </div>\n\n    $1`
  );

  return out;
}

for (const name of FILES) {
  const file = path.join(PUBLIC, name);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = fixFooter(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log("fixed:", name);
  } else {
    console.log("unchanged:", name);
  }
}

console.log("Done.");
