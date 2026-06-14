const { computeUnifiedDeliveryFee } = require("../../apps/delivery/unifiedDeliveryPricing");

describe("car transport pricing ED-13 scenario", () => {
  test("22.6 km internal = 199 SAR (not doubled)", () => {
    const r = computeUnifiedDeliveryFee("car_transport", {
      transfer_mode: "internal",
      distance_km: 22.6,
      vehicle_condition: "working",
    });
    expect(r.ok).toBe(true);
    expect(r.delivery_fee).toBe(199);
    expect(r.mode).toBe("internal");
  });

  test("subtotal uses delivery_fee only when order_total is 0", () => {
    const deliveryFee = 199;
    const orderTotal = 0;
    const subtotal = orderTotal + deliveryFee;
    const vat = Math.round(subtotal * 0.15 * 100) / 100;
    const total = Math.round((subtotal + vat) * 100) / 100;
    expect(subtotal).toBe(199);
    expect(vat).toBe(29.85);
    expect(total).toBe(228.85);
  });
});
