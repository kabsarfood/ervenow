const { preferHaversineIfOsrmInsane, haversineKm } = require("../../shared/utils/osrmClient");

describe("OSRM sanity vs haversine", () => {
  test("identical points: huge OSRM distance is discarded", () => {
    const hv = haversineKm(24.7139, 46.6759, 24.7139, 46.6759);
    expect(preferHaversineIfOsrmInsane(4389.4, hv)).toBe(hv);
    expect(hv).toBeLessThan(0.01);
  });

  test("nearby points: plausible OSRM is kept", () => {
    const hv = haversineKm(24.7139, 46.6759, 24.7145, 46.6765);
    expect(preferHaversineIfOsrmInsane(0.47, hv)).toBe(0.47);
  });

  test("nearby points: transcontinental OSRM is discarded when haversine is local", () => {
    const hv = haversineKm(24.7139, 46.6759, 24.7145, 46.6765);
    expect(preferHaversineIfOsrmInsane(4389.41, hv)).toBe(hv);
  });
});
