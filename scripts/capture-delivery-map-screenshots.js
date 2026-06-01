/**
 * Screenshots: /delivery-map — mobile, tablet, desktop
 * Usage: node scripts/capture-delivery-map-screenshots.js [baseUrl]
 */
const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://127.0.0.1:4000";
const OUT = path.join(__dirname, "..", "docs", "screenshots", "delivery-map-page");

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1280, height: 900 },
];

async function main() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    console.error("Playwright required");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await playwright.chromium.launch({ headless: true });
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(`${BASE}/delivery-map`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#pickupDropMap", { timeout: 20000 });
    await page.waitForTimeout(1200);
    const file = path.join(OUT, `delivery-map-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
    await page.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
