/**
 * CLS source attribution — homepage 390px
 * node scripts/mobile-cls-debug.js
 */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.addInitScript(() => {
    window.__clsLog = [];
    try {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          var sources = (e.sources || []).map(function (s) {
            var n = s.node;
            var id = "";
            if (n && n.nodeType === 1) {
              id =
                n.tagName +
                (n.id ? "#" + n.id : "") +
                (n.className ? "." + String(n.className).split(" ").slice(0, 2).join(".") : "");
            }
            return { node: id };
          });
          window.__clsLog.push({ value: e.value, hadRecentInput: e.hadRecentInput, sources: sources });
        });
      });
      po.observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
  });

  await page.goto("http://localhost:4000/", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const log = await page.evaluate(() => {
    var total = 0;
    (window.__clsLog || []).forEach(function (e) {
      if (!e.hadRecentInput) total += e.value;
    });
    return { total: Math.round(total * 1000) / 1000, entries: window.__clsLog || [] };
  });

  const grouped = {};
  log.entries.forEach((e) => {
    if (e.hadRecentInput) return;
    (e.sources || []).forEach((s) => {
      const k = s.node || "unknown";
      grouped[k] = (grouped[k] || 0) + e.value;
    });
  });
  const top = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => ({ node: k, cls: Math.round(v * 1000) / 1000 }));

  console.log(JSON.stringify({ totalCls: log.total, topSources: top }, null, 2));
  await browser.close();
})();
