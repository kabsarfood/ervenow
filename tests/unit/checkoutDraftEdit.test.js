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

  test("order-draft-badge.js enforces /checkout nav (no legacy drawer)", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/order-draft-badge.js"), "utf8");
    expect(js).toMatch(/enforceCheckoutNav/);
    expect(js).toMatch(/removeLegacyCartUi/);
    expect(js).toMatch(/lpCartWrap/);
    expect(js).toMatch(/\/checkout/);
    expect(js).toMatch(/لا توجد عناصر حالياً في الطلب/);
  });

  test("dashboard.html cart link goes to /checkout only", () => {
    const html = fs.readFileSync(path.join(ROOT, "public/dashboard.html"), "utf8");
    expect(html).toMatch(/dash-header-cart[^>]+href="\/checkout"/);
    expect(html).not.toMatch(/cart-ui\.js/);
    expect(html).not.toMatch(/cart\.js/);
  });

  test("order-draft-store supports logout stash and session restore", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/order-draft-store.js"), "utf8");
    expect(js).toMatch(/stashDraftForUser/);
    expect(js).toMatch(/restoreDraftForUser/);
    expect(js).toMatch(/clearPlatformDraftState/);
    expect(js).toMatch(/prepareLogoutDraftState/);
    expect(js).toMatch(/applySessionDraftPolicy/);
    expect(js).toMatch(/markSessionEnded/);
    expect(js).toMatch(/restoreDraftAfterLogin/);
    expect(js).toMatch(/ervenow:order-draft:saved:/);
  });

  test("order-draft-badge respects session draft policy on boot", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/order-draft-badge.js"), "utf8");
    expect(js).toMatch(/applySessionDraftPolicy/);
    expect(js).toMatch(/allowMigrate/);
  });

  test("guest-shell logout clears draft and restores on login", () => {
    const js = fs.readFileSync(path.join(ROOT, "public/assets/guest-shell.js"), "utf8");
    expect(js).toMatch(/prepareLogoutDraftState/);
    expect(js).toMatch(/restoreDraftAfterLogin/);
    expect(js).toMatch(/markSessionEnded/);
    expect(js).toMatch(/clearPlatformDraftState/);
  });
});
