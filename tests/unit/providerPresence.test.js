const {
  providerLocationMeaningfullyMoved,
  PROVIDER_LOCATION_MOVE_METERS,
} = require("../../shared/utils/geo");

describe("provider location vs presence", () => {
  test("movement threshold is 40 meters", () => {
    expect(PROVIDER_LOCATION_MOVE_METERS).toBe(40);
  });

  test("first coordinates are always a location write", () => {
    expect(providerLocationMeaningfullyMoved(null, 24.7136, 46.6753)).toBe(true);
  });

  test("standing still does not write coordinates", () => {
    const here = { lat: 24.7136, lng: 46.6753 };
    expect(providerLocationMeaningfullyMoved(here, here.lat, here.lng)).toBe(false);
    expect(providerLocationMeaningfullyMoved(here, here.lat + 0.00005, here.lng)).toBe(false);
  });

  test("a move of about 50 meters writes coordinates", () => {
    const here = { lat: 24.7136, lng: 46.6753 };
    expect(providerLocationMeaningfullyMoved(here, here.lat + 0.0005, here.lng)).toBe(true);
  });
});