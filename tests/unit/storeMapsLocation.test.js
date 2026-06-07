const { storeHasOfficialLocation, applyMapsUrlToStorePatch } = require("../../shared/utils/storeMapsLocation");

describe("storeMapsLocation", () => {
  test("storeHasOfficialLocation accepts valid coords", () => {
    expect(storeHasOfficialLocation({ lat: 24.7, lng: 46.6 })).toBe(true);
    expect(storeHasOfficialLocation({ lat: null, lng: 46.6 })).toBe(false);
    expect(storeHasOfficialLocation(null)).toBe(false);
  });

  test("applyMapsUrlToStorePatch parses lat,lng pair", async () => {
    const patch = {};
    const got = await applyMapsUrlToStorePatch(patch, "24.7136,46.6753");
    expect(got.ok).toBe(true);
    expect(got.applied).toBe(true);
    expect(patch.lat).toBeCloseTo(24.7136, 4);
    expect(patch.lng).toBeCloseTo(46.6753, 4);
    expect(patch.maps_url).toMatch(/google\.com\/maps|24\.7136/);
  });

  test("applyMapsUrlToStorePatch rejects invalid url", async () => {
    const patch = {};
    const got = await applyMapsUrlToStorePatch(patch, "not-a-maps-link");
    expect(got.ok).toBe(false);
  });
});
