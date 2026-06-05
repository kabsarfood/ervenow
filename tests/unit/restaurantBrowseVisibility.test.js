const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  storeRowCountsAsRestaurant,
  restaurantCategoryMatchesCuisineSlug,
  restaurantRowMatchesCuisineFilter,
} = require("../../shared/restaurantCategories");

test("storeRowCountsAsRestaurant — type restaurant", () => {
  assert.equal(storeRowCountsAsRestaurant({ type: "restaurant", category: "kabsa" }), true);
});

test("storeRowCountsAsRestaurant — legacy kabsa category", () => {
  assert.equal(storeRowCountsAsRestaurant({ type: "supermarket", category: "kabsa" }), true);
});

test("kabsa legacy category matches kabsa_bukhari filter", () => {
  assert.equal(restaurantCategoryMatchesCuisineSlug("kabsa", "kabsa_bukhari"), true);
  const row = { type: "restaurant", category: "kabsa" };
  assert.equal(restaurantRowMatchesCuisineFilter(row, "kabsa_bukhari"), true);
});

test("kabsar name infers kabsa_bukhari when category missing", () => {
  const {
    inferRestaurantCuisineFromName,
    resolveRestaurantBrowseCategory,
    storeRowCountsAsRestaurant,
    restaurantRowMatchesCuisineFilter,
  } = require("../../shared/restaurantCategories");
  assert.equal(inferRestaurantCuisineFromName("مطعم كبسار"), "kabsa_bukhari");
  const row = { type: "supermarket", name: "Kabsar Restaurant", category: null };
  assert.equal(storeRowCountsAsRestaurant(row), true);
  assert.equal(resolveRestaurantBrowseCategory(row), "kabsa_bukhari");
  assert.equal(restaurantRowMatchesCuisineFilter(row, "kabsa_bukhari"), true);
});
