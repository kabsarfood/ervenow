const {
  normalizeDeliveryPolicy,
  fulfillmentAllowedForStore,
  computeDeliveryFeeQuote,
  storePolicyRowToConfig,
} = require("../../shared/services/deliveryPolicyEngine");

describe("deliveryPolicyEngine", () => {
  test("normalizeDeliveryPolicy defaults unknown to ervenow_delivery", () => {
    expect(normalizeDeliveryPolicy("invalid")).toBe("ervenow_delivery");
    expect(normalizeDeliveryPolicy("pickup_only")).toBe("pickup_only");
  });

  test("fulfillmentAllowedForStore respects store_plus_ervenow", () => {
    expect(fulfillmentAllowedForStore("pickup", "store_plus_ervenow")).toBe(false);
    expect(fulfillmentAllowedForStore("store_delivery", "store_plus_ervenow")).toBe(true);
    expect(fulfillmentAllowedForStore("ervenow_delivery", "store_plus_ervenow")).toBe(true);
  });

  test("computeDeliveryFeeQuote — product includes delivery", () => {
    const cfg = storePolicyRowToConfig({ delivery_policy: "ervenow_delivery", free_delivery_policy: "none" });
    const q = computeDeliveryFeeQuote({
      storeConfig: cfg,
      distance_km: 5,
      subtotal: 50,
      fulfillment: "ervenow_delivery",
      product_includes_delivery: true,
    });
    expect(q.delivery_fee).toBe(0);
    expect(q.delivery_free).toBe(true);
    expect(q.delivery_policy).toBe("included");
  });

  test("computeDeliveryFeeQuote — min_order free", () => {
    const cfg = storePolicyRowToConfig({
      delivery_policy: "ervenow_delivery",
      free_delivery_policy: "min_order",
      free_delivery_min_order: 100,
    });
    const q = computeDeliveryFeeQuote({
      storeConfig: cfg,
      distance_km: 4,
      subtotal: 120,
      fulfillment: "ervenow_delivery",
    });
    expect(q.delivery_free).toBe(true);
    expect(q.delivery_policy).toBe("free_above_minimum");
  });

  test("pickup fulfillment has zero fee", () => {
    const cfg = storePolicyRowToConfig({ delivery_policy: "pickup_only" });
    const q = computeDeliveryFeeQuote({
      storeConfig: cfg,
      distance_km: 10,
      fulfillment: "pickup",
    });
    expect(q.delivery_fee).toBe(0);
    expect(q.delivery_free).toBe(true);
  });
});
