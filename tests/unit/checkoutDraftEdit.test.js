const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("Checkout V1.2 — draft editing", () => {
  test("checkout-draft-edit.js uses ErvenowOrderDraft only", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/checkout-draft-edit.js"), "utf8");
    expect(js).toMatch(/ErvenowOrderDraft/);
    expect(js).toMatch(/writeDraft/);
    expect(js).not.toMatch(/ErvenowCart/);
    expect(js).not.toMatch(/cart\.js/);
    expect(js).not.toMatch(/cart-ui\.js/);
  });

  test("checkout.html exposes draft edit controls", () => {
    const html = fs.readFileSync(path.join(ROOT, "public/checkout.html"), "utf8");
    expect(html).toMatch(/checkoutClearAllBtn/);
    expect(html).toMatch(/checkoutOrderNotes/);
    expect(html).toMatch(/checkoutLocationInput/);
    expect(html).toMatch(/checkout-draft-edit\.js/);
  });

  test("order draft schema supports order_notes", () => {
    const schema = fs.readFileSync(path.join(ROOT, "shared/orderDraft/orderDraftSchema.js"), "utf8");
    expect(schema).toMatch(/order_notes/);
  });
});
