const fs = require("fs");
const p = require("path").join(__dirname, "..", "public", "dashboard.html");
if (!require("fs").existsSync(p)) {
  console.log("skip: public/dashboard.html retired");
  process.exit(0);
}
let h = fs.readFileSync(p, "utf8");
h = h.replace(/<style>([\s\S]*?)<\/style>/, (m, style) => {
  const lines = style.split("\n");
  const out = [];
  for (const line of lines) {
    if (line.includes(".cat-card--map-link")) {
      out.push(line);
      continue;
    }
    if (
      /dash-map-modal|dashDeliveryTitle|cat-card--map[^-]|map-canvas|delivery-panel|delivery-form\.map-canvas|#pickupDropMap|delivery-live-map-link|dash-map-h/.test(
        line
      )
    ) {
      continue;
    }
    out.push(line);
  }
  return "<style>" + out.join("\n") + "</style>";
});
fs.writeFileSync(p, h);
console.log("done");
