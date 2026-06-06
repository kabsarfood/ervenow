const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

const DRAFT_VERTICAL_PAGES = [
  "public/store.html",
  "public/services.html",
  "public/gas-delivery.html",
  "public/delivery-services.html",
  "public/delivery-map.html",
  "public/order.html",
  "public/browse.html",
];

const LEGACY_CART_PATTERNS = [
  { re: /ErvenowCart\.add\s*\(/, label: "ErvenowCart.add()" },
  { re: /ErvenowServiceCart\.add\s*\(/, label: "ErvenowServiceCart.add()" },
  { re: /<script[^>]+service-cart\.js/, label: "service-cart.js script" },
];

describe("Checkout Engine Phase 3 — vertical draft wiring", () => {
  test("vertical entry pages load order-draft-vertical.js", () => {
    DRAFT_VERTICAL_PAGES.forEach(function (rel) {
      const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(html).toMatch(/order-draft-vertical\.js/);
      expect(html).toMatch(/order-draft-store\.js/);
    });
  });

  test("vertical entry pages do not call legacy cart add APIs inline", () => {
    const violations = [];
    DRAFT_VERTICAL_PAGES.forEach(function (rel) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      LEGACY_CART_PATTERNS.forEach(function (rule) {
        if (rule.re.test(text)) violations.push(rel + " → " + rule.label);
      });
    });
    expect(violations).toEqual([]);
  });

  test("delivery-map-page.js commits via ErvenowOrderDraftVertical", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/delivery-map-page.js"), "utf8");
    expect(js).toMatch(/ErvenowOrderDraftVertical\.commit/);
    expect(js).not.toMatch(/ErvenowServiceCart\.add/);
    expect(js).toMatch(/pending-map-draft/);
  });

  test("pre-cart-delivery reads draft items not getCart", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/pre-cart-delivery.js"), "utf8");
    expect(js).toMatch(/getDraftItems/);
    expect(js).not.toMatch(/global\.getCart/);
  });
});
