const {
  normalizeOrderTrackingCoords,
  isPlausibleCoord,
  maybeSwapLatLng,
} = require("../../shared/utils/orderTrackingCoords");

describe("orderTrackingCoords", () => {
  test("maybeSwapLatLng fixes reversed lat/lng in Saudi", () => {
    const fixed = maybeSwapLatLng(46.6753, 24.7136);
    expect(fixed.swapped).toBe(true);
    expect(fixed.lat).toBeCloseTo(24.7136, 3);
    expect(fixed.lng).toBeCloseTo(46.6753, 3);
  });

  test("normalizeOrderTrackingCoords reads from_location/to_location", () => {
    const order = {
      data: {
        from_location: { lat: 46.6753, lng: 24.7136 },
        to_location: { lat: 46.702, lng: 24.774 },
        distance_km: 150,
      },
    };
    normalizeOrderTrackingCoords(order);
    expect(isPlausibleCoord(order.pickup_lat, order.pickup_lng)).toBe(true);
    expect(isPlausibleCoord(order.drop_lat, order.drop_lng)).toBe(true);
    expect(order.distance_km).toBe(150);
  });

  test("drops absurd distance_km values", () => {
    const order = { distance_km: 5721.2, data: {} };
    normalizeOrderTrackingCoords(order);
    expect(order.distance_km).toBeNull();
  });
});
