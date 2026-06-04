const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDeliveryPolicy,
  normalizeFulfillment,
  fulfillmentAllowedForStore,
  computeDeliveryFeeQuote,
  storePolicyRowToConfig,
} = require("../../shared/services/deliveryPolicyEngine");

test("normalizeDeliveryPolicy defaults unknown to ervenow_delivery", () => {
  assert.equal(normalizeDeliveryPolicy("invalid"), "ervenow_delivery");
  assert.equal(normalizeDeliveryPolicy("pickup_only"), "pickup_only");
});

test("fulfillmentAllowedForStore respects store_plus_ervenow", () => {
  assert.equal(fulfillmentAllowedForStore("pickup", "store_plus_ervenow"), false);
  assert.equal(fulfillmentAllowedForStore("store_delivery", "store_plus_ervenow"), true);
  assert.equal(fulfillmentAllowedForStore("ervenow_delivery", "store_plus_ervenow"), true);
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
  assert.equal(q.delivery_fee, 0);
  assert.equal(q.delivery_free, true);
  assert.equal(q.delivery_policy, "included");
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
  assert.equal(q.delivery_free, true);
  assert.equal(q.delivery_policy, "free_above_minimum");
});

test("pickup fulfillment has zero fee", () => {
  const cfg = storePolicyRowToConfig({ delivery_policy: "pickup_only" });
  const q = computeDeliveryFeeQuote({
    storeConfig: cfg,
    distance_km: 10,
    fulfillment: "pickup",
  });
  assert.equal(q.delivery_fee, 0);
  assert.equal(q.delivery_free, true);
});
