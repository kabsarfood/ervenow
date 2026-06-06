const {
  storeRowCountsAsRestaurant,
  restaurantCategoryMatchesCuisineSlug,
  restaurantRowMatchesCuisineFilter,
  inferRestaurantCuisineFromName,
  resolveRestaurantBrowseCategory,
} = require("../../shared/restaurantCategories");

describe("restaurantBrowseVisibility", () => {
  test("storeRowCountsAsRestaurant — type restaurant", () => {
    expect(storeRowCountsAsRestaurant({ type: "restaurant", category: "kabsa" })).toBe(true);
  });

  test("storeRowCountsAsRestaurant — legacy kabsa category", () => {
    expect(storeRowCountsAsRestaurant({ type: "supermarket", category: "kabsa" })).toBe(true);
  });

  test("kabsa legacy category matches kabsa_bukhari filter", () => {
    expect(restaurantCategoryMatchesCuisineSlug("kabsa", "kabsa_bukhari")).toBe(true);
    const row = { type: "restaurant", category: "kabsa" };
    expect(restaurantRowMatchesCuisineFilter(row, "kabsa_bukhari")).toBe(true);
  });

  test("kabsar name infers kabsa_bukhari when category missing", () => {
    expect(inferRestaurantCuisineFromName("مطعم كبسار")).toBe("kabsa_bukhari");
    const row = { type: "supermarket", name: "Kabsar Restaurant", category: null };
    expect(storeRowCountsAsRestaurant(row)).toBe(true);
    expect(resolveRestaurantBrowseCategory(row)).toBe("kabsa_bukhari");
    expect(restaurantRowMatchesCuisineFilter(row, "kabsa_bukhari")).toBe(true);
  });
});
