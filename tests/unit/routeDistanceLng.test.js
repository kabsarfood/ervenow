jest.mock("../../shared/utils/redisCache", () => ({
  cacheGet: async () => null,
  cacheSet: async () => {},
}));

let lastPair = null;
jest.mock("../../shared/utils/osrmClient", () => {
  const actual = jest.requireActual("../../shared/utils/osrmClient");
  return {
    ...actual,
    getOsrmRouteKmOrHaversine: jest.fn(async (from, to) => {
      lastPair = { from, to };
      return 1.2;
    }),
  };
});

const { routeKmWithRoughFallback } = require("../../shared/utils/routeDistance");

describe("routeKmWithRoughFallback coordinates", () => {
  test("passes destination longitude not a copy of destination latitude", async () => {
    lastPair = null;
    const km = await routeKmWithRoughFallback(24.7, 46.7, 24.8, 46.8);
    expect(km).toBe(1.2);
    expect(lastPair.from).toEqual({ lat: 24.7, lng: 46.7 });
    expect(lastPair.to).toEqual({ lat: 24.8, lng: 46.8 });
  });
});
