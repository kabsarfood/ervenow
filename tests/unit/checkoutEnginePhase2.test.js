const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const CHECKOUT_FILES = [
  "public/checkout.html",
  "public/assets/checkout-engine.js",
  "public/assets/checkout-draft-edit.js",
  "public/assets/checkout-payment-engine.js",
  "public/assets/checkout-page.css",
];

const FORBIDDEN_DEPS = ["cart-ui.js", "service-cart.js", "pre-cart-delivery.js"];
const FORBIDDEN_SCRIPT_RE = /(?:src|require)\s*=\s*["'][^"']*(?:cart\.js|cart-ui\.js|service-cart\.js|pre-cart-delivery\.js)/;

const FORBIDDEN_PATTERNS = [
  { re: /localStorage\.getItem\s*\(\s*["']cart["']\s*\)/, label: 'direct localStorage["cart"] read' },
  { re: /ErvenowCart\b/, label: "ErvenowCart reference" },
  { re: /executeCartCheckout/, label: "executeCartCheckout" },
  { re: /\/api\/checkout(?!-payment-methods)/, label: "POST /api/checkout" },
];

describe("Checkout Engine Phase 2 rules", () => {
  test("checkout files exist", () => {
    CHECKOUT_FILES.forEach(function (rel) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    });
  });

  test("checkout files do not load forbidden cart modules", () => {
    const violations = [];
    CHECKOUT_FILES.forEach(function (rel) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (FORBIDDEN_SCRIPT_RE.test(text)) violations.push(rel + " → forbidden script import");
      FORBIDDEN_DEPS.forEach(function (dep) {
        if (text.includes(dep)) violations.push(rel + " → " + dep);
      });
    });
    expect(violations).toEqual([]);
  });

  test("checkout JS/HTML obey draft-only and unified API rules", () => {
    const violations = [];
    ["public/checkout.html", "public/assets/checkout-engine.js", "public/assets/checkout-payment-engine.js"].forEach(
      function (rel) {
        const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
        FORBIDDEN_PATTERNS.forEach(function (rule) {
          if (rule.re.test(text)) violations.push(rel + " → " + rule.label);
        });
        if (
          rel === "public/checkout.html" &&
          !text.includes("order-draft-store.js") &&
          !text.includes("ErvenowOrderDraft")
        ) {
          violations.push(rel + " → missing order draft store");
        }
        if (rel === "public/assets/checkout-engine.js" && !text.includes("ErvenowOrderDraft")) {
          violations.push(rel + " → missing ErvenowOrderDraft");
        }
        if (rel === "public/assets/checkout-engine.js" && !text.includes("/api/order/create")) {
          violations.push(rel + " → missing POST /api/order/create");
        }
        if (rel === "public/assets/checkout-engine.js" && !text.includes("clearDraft")) {
          violations.push(rel + " → missing clearDraft on success");
        }
      }
    );
    expect(violations).toEqual([]);
  });

  test("checkout.html has single confirm button and no mini cart", () => {
    const html = fs.readFileSync(path.join(ROOT, "public/checkout.html"), "utf8");
    const confirmMatches = html.match(/id="checkoutConfirmBtn"/g) || [];
    expect(confirmMatches.length).toBe(1);
    expect(html).not.toMatch(/lpCart|cart-ui|cart\.js|mini-cart|dash-header-cart/i);
  });
});
