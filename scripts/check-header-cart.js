const { chromium } = require("playwright");

const PAGES = ["/", "/start-now", "/restaurants", "/stores"];

(async () => {
  const b = await chromium.launch({ headless: true });
  for (const url of PAGES) {
    const p = await b.newPage();
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto("http://localhost:4000" + url + "?t=" + Date.now(), { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      function vis(sel) {
        var el = document.querySelector(sel);
        if (!el) return { found: false, visible: false };
        var cs = getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        var visible =
          rect.width > 1 &&
          rect.height > 1 &&
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          parseFloat(cs.opacity) > 0;
        return {
          found: true,
          visible: visible,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          display: cs.display,
          opacity: cs.opacity,
        };
      }
      return {
        url: location.pathname,
        shell: document.documentElement.classList.contains("erv-mobile-shell"),
        harmonyCss: !!document.querySelector('link[href*="mobile-harmony.css"]'),
        headerCart: vis(".lp-draft-checkout-badge, .dash-header-cart"),
        headerTools: vis(".dash-site-header__tools"),
        bottomCart: vis('.erv-mobile-bottom-nav__item[data-erv-nav="cart"]'),
      };
    });
    console.log(JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
