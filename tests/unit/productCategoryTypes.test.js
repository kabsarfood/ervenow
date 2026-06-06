const {
  productCatalogTypeForStoreType,
  normalizeProductSlugForCatalog,
  builtinCatalogEntries,
} = require("../../shared/productCategoryTypes");

describe("productCategoryTypes", () => {
  test("restaurant store maps to restaurant catalog", () => {
    expect(productCatalogTypeForStoreType("restaurant")).toBe("restaurant");
  });

  test("pharmacy store maps to pharmacy catalog", () => {
    expect(productCatalogTypeForStoreType("pharmacy")).toBe("pharmacy");
  });

  test("restaurant catalog includes kabsa_bukhari", () => {
    const slugs = builtinCatalogEntries("restaurant").map((e) => e.slug);
    expect(slugs).toContain("kabsa_bukhari");
    expect(slugs).toContain("shawarma_grill");
  });

  test("normalizeProductSlugForCatalog accepts restaurant slug", () => {
    expect(normalizeProductSlugForCatalog("restaurant", "shawarma_grill")).toBe("shawarma_grill");
  });
});
