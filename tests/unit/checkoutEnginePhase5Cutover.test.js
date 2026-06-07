const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "../../public");
const SERVER_JS = path.join(__dirname, "../../server/server.js");

function readPublic(rel) {
  return fs.readFileSync(path.join(PUBLIC_DIR, rel), "utf8");
}

describe("Checkout Engine Phase 5 — cutover", () => {
  test("GET /cart redirects to /checkout", () => {
    const server = fs.readFileSync(SERVER_JS, "utf8");
    expect(server).toMatch(/app\.get\(["']\/cart["']/);
    expect(server).toMatch(/redirect\(302,\s*["']\/checkout["']\)/);
  });

  test("index.html uses draft badge instead of legacy mini cart", () => {
    const html = readPublic("index.html");
    expect(html).not.toMatch(/<script[^>]+cart\.js/);
    expect(html).not.toMatch(/id="lpCartWrap"/);
    expect(html).toMatch(/order-draft-badge\.js/);
    expect(html).toMatch(/href="\/checkout"/);
  });

  test("guest-shell header links to /checkout", () => {
    const js = readPublic("assets/guest-shell.js");
    expect(js).toMatch(/href="\/checkout"/);
    expect(js).not.toMatch(/loadCartUi/);
    expect(js).toMatch(/loadDraftBadge/);
  });

  test("customer pages no longer load cart.js for badge-only shells", () => {
    const pages = [
      "browse.html",
      "dashboard.html",
      "track.html",
      "stores.html",
      "restaurants.html",
      "my-orders.html",
    ];
    for (const page of pages) {
      const html = readPublic(page);
      expect(html).not.toMatch(/<script[^>]+cart\.js/);
      expect(html).toMatch(/order-draft-badge\.js/);
    }
  });

  test("cart-ui mountGuestHeaderCart does not inject lpCart drawer", () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, "assets/cart-ui.js"), "utf8");
    var fn = js.slice(js.indexOf("function mountGuestHeaderCart"), js.indexOf("global.ErvenowCartUI"));
    expect(fn).toMatch(/enforceCheckoutNav/);
    expect(fn).not.toMatch(/lpCartWrap/);
    expect(fn).not.toMatch(/initCartToggle/);
  });

  test("legacy cart.js traffic redirects to /checkout", () => {
    const cartJs = readPublic("assets/cart.js");
    expect(cartJs).toMatch(/window\.location\.href\s*=\s*["']\/checkout["']/);
    expect(cartJs).not.toMatch(/window\.location\.href\s*=\s*["']\/cart["']/);
  });
});
