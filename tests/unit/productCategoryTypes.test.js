const test = require("node:test");
const assert = require("node:assert/strict");
const {
  productCatalogTypeForStoreType,
  normalizeProductSlugForCatalog,
  builtinCatalogEntries,
} = require("../../shared/productCategoryTypes");

test("restaurant store maps to restaurant catalog", () => {
  assert.equal(productCatalogTypeForStoreType("restaurant"), "restaurant");
});

test("pharmacy store maps to pharmacy catalog", () => {
  assert.equal(productCatalogTypeForStoreType("pharmacy"), "pharmacy");
});

test("restaurant catalog includes kabsa_bukhari", () => {
  const slugs = builtinCatalogEntries("restaurant").map((e) => e.slug);
  assert.ok(slugs.includes("kabsa_bukhari"));
  assert.ok(slugs.includes("shawarma_grill"));
});

test("normalizeProductSlugForCatalog accepts restaurant slug", () => {
  assert.equal(normalizeProductSlugForCatalog("restaurant", "shawarma_grill"), "shawarma_grill");
});
