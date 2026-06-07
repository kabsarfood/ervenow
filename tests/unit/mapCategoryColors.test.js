const {
  mapCategoryFromStoreType,
  resolveMapColorForStoreType,
  mergeMapColorsIntoBranding,
  DEFAULT_MAP_COLORS,
} = require("../../shared/utils/mapCategoryColors");

describe("mapCategoryColors", () => {
  test("mapCategoryFromStoreType maps known types", () => {
    expect(mapCategoryFromStoreType("restaurant")).toBe("restaurant");
    expect(mapCategoryFromStoreType("pharmacy")).toBe("pharmacy");
    expect(mapCategoryFromStoreType("supermarket")).toBe("store");
    expect(mapCategoryFromStoreType("services")).toBe("service");
  });

  test("resolveMapColorForStoreType reads admin settings", () => {
    const settings = { map_color_restaurant: "#aabbcc" };
    expect(resolveMapColorForStoreType("restaurant", settings)).toBe("#aabbcc");
    expect(resolveMapColorForStoreType("restaurant", {})).toBe(DEFAULT_MAP_COLORS.map_color_restaurant);
  });

  test("mergeMapColorsIntoBranding fills missing keys", () => {
    const merged = mergeMapColorsIntoBranding({ primary_color: "#111111" });
    expect(merged.map_color_store).toBe(DEFAULT_MAP_COLORS.map_color_store);
    expect(merged.primary_color).toBe("#111111");
  });
});
