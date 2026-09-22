const {
  storeRowIsListedActive,
  storeRowIsMerchantManageable,
  storeRowNeedsCompletion,
  storeRowIsReopenableOnboarding,
  validatePublishReadiness,
  approveStorePatch,
  rejectStorePatch,
  needsInfoStorePatch,
  publishStorePatch,
} = require("../../shared/utils/storePublication");

describe("storePublication", () => {
  test("legacy approved+active without publication_status stays listed", () => {
    expect(storeRowIsListedActive({ status: "approved", is_active: true })).toBe(true);
    expect(storeRowIsListedActive({ status: "approved" })).toBe(true);
  });

  test("approved draft is not listed even if is_active true", () => {
    expect(
      storeRowIsListedActive({
        status: "approved",
        is_active: true,
        publication_status: "draft",
      })
    ).toBe(false);
  });

  test("approved published is listed", () => {
    expect(
      storeRowIsListedActive({
        status: "approved",
        is_active: true,
        publication_status: "published",
      })
    ).toBe(true);
  });

  test("pending / rejected / paused are not listed", () => {
    expect(storeRowIsListedActive({ status: "pending", is_active: false })).toBe(false);
    expect(storeRowIsListedActive({ status: "needs_info", is_active: false })).toBe(false);
    expect(storeRowIsListedActive({ status: "rejected", is_active: false })).toBe(false);
    expect(
      storeRowIsListedActive({
        status: "approved",
        is_active: true,
        publication_status: "paused",
      })
    ).toBe(false);
  });

  test("approve does not publish", () => {
    const p = approveStorePatch();
    expect(p.status).toBe("approved");
    expect(p.publication_status).toBe("draft");
    expect(p.is_active).toBe(true);
  });

  test("reject never publishes", () => {
    const p = rejectStorePatch();
    expect(p.status).toBe("rejected");
    expect(p.publication_status).toBe("draft");
    expect(p.is_active).toBe(false);
  });

  test("needs_info stores the admin message", () => {
    const p = needsInfoStorePatch("أرفق صورة الرخصة");
    expect(p.status).toBe("needs_info");
    expect(p.needs_info_message).toBe("أرفق صورة الرخصة");
    expect(p.publication_status).toBe("draft");
  });

  test("merchant can manage approved draft", () => {
    const row = { status: "approved", is_active: true, publication_status: "draft" };
    expect(storeRowIsMerchantManageable(row)).toBe(true);
    expect(storeRowNeedsCompletion(row)).toBe(true);
    expect(storeRowIsListedActive(row)).toBe(false);
  });

  test("pending and needs_info are reopenable onboarding", () => {
    expect(storeRowIsReopenableOnboarding({ status: "pending" })).toBe(true);
    expect(storeRowIsReopenableOnboarding({ status: "needs_info" })).toBe(true);
    expect(storeRowIsReopenableOnboarding({ status: "approved" })).toBe(false);
  });

  test("publish validation requires name location category identity product", () => {
    const store = {
      name: "مطعم النخبة",
      type: "restaurant",
      category: "kabsa_bukhari",
      lat: 24.7,
      lng: 46.6,
      logo_url: "https://cdn.example/logo.jpg",
    };
    const products = [{ name: "كبسة", price: 28, active: true }];
    const ok = validatePublishReadiness(store, { banner_url: null }, products);
    expect(ok.ok).toBe(true);

    const missingCat = validatePublishReadiness(
      { ...store, category: "" },
      { banner_url: null },
      products
    );
    expect(missingCat.ok).toBe(false);
    expect(missingCat.missing).toContain("الفئة");

    const noProduct = validatePublishReadiness(store, { banner_url: null }, []);
    expect(noProduct.ok).toBe(false);

    const inactive = validatePublishReadiness(store, { banner_url: null }, [
      { name: "كبسة", price: 28, active: false },
    ]);
    expect(inactive.ok).toBe(false);
  });

  test("store type without extra cuisine still has a category", () => {
    const got = validatePublishReadiness(
      {
        name: "صيدلية النور",
        type: "pharmacy",
        category: "",
        lat: 21.4,
        lng: 39.8,
        logo_url: "https://cdn.example/logo.jpg",
      },
      {},
      [{ name: "فيتامين", price: 12, active: true }]
    );
    expect(got.ok).toBe(true);
  });

  test("publish patch sets published", () => {
    expect(publishStorePatch()).toEqual({ publication_status: "published", is_active: true });
  });
});
