/**
 * Remove site footers from public HTML (keeps index.html lp-footer)
 * node scripts/strip-site-footers.js
 */
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "public");
const SKIP = new Set(["index.html"]);

const FOOTER_PATTERNS = [
  /<footer class="dash-site-footer[\s\S]*?<\/footer>\s*/gi,
  /<footer class="preview-hub-footer[\s\S]*?<\/footer>\s*/gi,
  /<footer class="preview-rest-foot[\s\S]*?<\/footer>\s*/gi,
  /<footer class="adm-foot[\s\S]*?<\/footer>\s*/gi,
];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
}

const files = [];
walk(PUBLIC, files);
let changed = 0;

for (const file of files) {
  const rel = path.relative(PUBLIC, file).replace(/\\/g, "/");
  if (SKIP.has(rel)) continue;
  let html = fs.readFileSync(file, "utf8");
  const orig = html;
  for (const re of FOOTER_PATTERNS) {
    html = html.replace(re, "");
  }
  if (html !== orig) {
    fs.writeFileSync(file, html, "utf8");
    console.log("stripped", rel);
    changed++;
  }
}

console.log("done", changed, "files");
