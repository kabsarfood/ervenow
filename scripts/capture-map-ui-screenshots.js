/**
 * Capture dashboard map modal screenshots (desktop + mobile).
 * Usage: node scripts/capture-map-ui-screenshots.js [baseUrl]
 */
const path = require("path");
const fs = require("fs");

async function main() {
  const baseUrl = process.argv[2] || "http://127.0.0.1:3000";
  const outDir = path.join(__dirname, "..", "docs", "screenshots", "map-ui");
  fs.mkdirSync(outDir, { recursive: true });

  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    console.error("Playwright not installed. Run: npx playwright install chromium");
    process.exit(1);
  }

  const browser = await playwright.chromium.launch({ headless: true });

  async function openMapModal(page) {
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => {
      var tab = document.getElementById("tab-delivery");
      if (tab) tab.click();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      if (typeof openDashMapQuick === "function") {
        openDashMapQuick({ openForm: true });
        return;
      }
      var d = document.getElementById("dashDeliveryTitle");
      if (d) {
        d.open = true;
        document.body.classList.add("dash-map-modal-open");
      }
    });
    await page.waitForSelector("#dashDeliveryTitle[open]", { timeout: 15000 });
    await page.waitForTimeout(1200);
  }

  // Desktop
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ar-SA",
  });
  const desktopPage = await desktop.newPage();
  await openMapModal(desktopPage);
  const desktopPath = path.join(outDir, "map-modal-desktop.png");
  await desktopPage.screenshot({ path: desktopPath, fullPage: false });
  console.log("Saved:", desktopPath);
  await desktop.close();

  // Mobile
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-SA",
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  await openMapModal(mobilePage);
  const mobilePath = path.join(outDir, "map-modal-mobile.png");
  await mobilePage.screenshot({ path: mobilePath, fullPage: false });
  console.log("Saved:", mobilePath);

  // Mobile — links mode
  await mobilePage.evaluate(() => {
    if (typeof setDeliveryMode === "function") setDeliveryMode("links");
  });
  await mobilePage.waitForTimeout(800);
  const mobileLinksPath = path.join(outDir, "map-modal-mobile-links.png");
  await mobilePage.screenshot({ path: mobileLinksPath, fullPage: false });
  console.log("Saved:", mobileLinksPath);

  await mobile.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
