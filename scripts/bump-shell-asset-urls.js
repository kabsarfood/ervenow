const fs = require("fs");
const path = require("path");

const VER = process.argv[2] || "20260612";
const root = path.join(__dirname, "..", "public");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const reps = [
  [/\/assets\/viewport-fit\.js(?:\?[^"']*)?/g, "/assets/viewport-fit.js?erv=" + VER],
  [/\/assets\/mobile-harmony\.js(?:\?[^"']*)?/g, "/assets/mobile-harmony.js?erv=" + VER],
  [/\/assets\/mobile-harmony\.css(?:\?[^"']*)?/g, "/assets/mobile-harmony.css?erv=" + VER],
  [/\/assets\/mobile-foundation\.js(?:\?[^"']*)?/g, "/assets/mobile-foundation.js?erv=" + VER],
  [/\/assets\/mobile-foundation\.css(?:\?[^"']*)?/g, "/assets/mobile-foundation.css?erv=" + VER],
];

let count = 0;
for (const f of walk(root)) {
  let text = fs.readFileSync(f, "utf8");
  const orig = text;
  for (const [re, sub] of reps) text = text.replace(re, sub);
  if (text !== orig) {
    fs.writeFileSync(f, text);
    count += 1;
    console.log("updated", path.relative(root, f));
  }
}
console.log("done", count, "files, ver", VER);
