const fs = require("fs");
const path = require("path");

const CHECKOUT_ENGINE = path.join(__dirname, "../../public/assets/checkout-engine.js");

describe("checkout-engine.js — idempotency + confirm UX", () => {
  const source = fs.readFileSync(CHECKOUT_ENGINE, "utf8");

  test("confirmOrder catch clears session idempotency key before re-enable", () => {
    const fnStart = source.indexOf("async function confirmOrder()");
    const fnEnd = source.indexOf("function bindEvents()", fnStart);
    const confirmOrderSrc = source.slice(fnStart, fnEnd);
    const catchStart = confirmOrderSrc.lastIndexOf("} catch (e) {");
    const catchBlock = confirmOrderSrc.slice(catchStart);

    expect(catchBlock).toMatch(/clearCheckoutIdempotencyKey\s*\(\s*\)/);
    expect(catchBlock).toMatch(/resetCheckoutBtnIdle\s*\(\s*btn\s*\)/);
    expect(catchBlock.indexOf("clearCheckoutIdempotencyKey")).toBeLessThan(
      catchBlock.indexOf("resetCheckoutBtnIdle(btn)")
    );
  });

  test("confirm button disables immediately with processing label", () => {
    expect(source).toMatch(/checkoutInFlight\s*=\s*true/);
    expect(source).toMatch(/CHECKOUT_BTN_PROCESSING\s*=\s*"⏳ جاري معالجة الطلب\.\.\."/);
    expect(source).toMatch(/setCheckoutBtnState\(btn,\s*"processing",\s*CHECKOUT_BTN_PROCESSING\)/);
  });

  test("duplicate clicks are blocked while checkout is in flight", () => {
    expect(source).toMatch(/if\s*\(\s*checkoutInFlight\s*\)\s*return/);
    expect(source).toMatch(/if\s*\(\s*checkoutInFlight\s*\)\s*\{[\s\S]*ev\.preventDefault/);
  });
});
