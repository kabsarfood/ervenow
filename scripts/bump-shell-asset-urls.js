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
  [
    /\/assets\/mobile-home-conversion\.css(?:\?[^"']*)?/g,
    "/assets/mobile-home-conversion.css?erv=" + VER,
  ],
  [
    /\/assets\/mobile-fast-discovery\.css(?:\?[^"']*)?/g,
    "/assets/mobile-fast-discovery.css?erv=" + VER,
  ],
  [
    /\/assets\/mobile-home-conversion\.css(?:\?[^"']*)?/g,
    "/assets/mobile-home-conversion.css?erv=" + VER,
  ],
  [
    /\/assets\/guest-offers-carousel\.css(?:\?[^"']*)?/g,
    "/assets/guest-offers-carousel.css?erv=" + VER,
  ],
  [
    /\/assets\/guest-offers-carousel\.js(?:\?[^"']*)?/g,
    "/assets/guest-offers-carousel.js?erv=" + VER,
  ],
  [/\/assets\/guest-shell\.css(?:\?[^"']*)?/g, "/assets/guest-shell.css?erv=" + VER],
  [/\/assets\/guest-shell\.js(?:\?[^"']*)?/g, "/assets/guest-shell.js?erv=" + VER],
  [/\/assets\/api\.js(?:\?[^"']*)?/g, "/assets/api.js?erv=" + VER],
  [/\/assets\/kabsar-store-polish\.css(?:\?[^"']*)?/g, "/assets/kabsar-store-polish.css?erv=" + VER],
  [/\/assets\/cart\.js(?:\?[^"']*)?/g, "/assets/cart.js?erv=" + VER],
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

const viewportFit = path.join(root, "assets", "viewport-fit.js");
if (fs.existsSync(viewportFit)) {
  let vf = fs.readFileSync(viewportFit, "utf8");
  const next = vf.replace(/var ERV_SHELL_ASSET_VER = "[^"]+";/, 'var ERV_SHELL_ASSET_VER = "' + VER + '";');
  if (next !== vf) {
    fs.writeFileSync(viewportFit, next);
    console.log("updated assets/viewport-fit.js ERV_SHELL_ASSET_VER");
  }
}

console.log("done", count, "html files, ver", VER);
