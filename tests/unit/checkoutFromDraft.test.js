const {
  buildFinancialIntent,
  buildOrderCreatePayload,
  resolveDeliveryFeeFromDraft,
  resolvePostCheckoutRedirectUrl,
  needsDeliveryCoords,
} = require("../../shared/checkout/checkoutFromDraft");

describe("checkoutFromDraft", () => {
  const storeItem = {
    type: "store",
    price: 100,
    data: {
      store_id: "s1",
      product_id: "p1",
      qty: 1,
      fulfillment_mode: "ervenow_delivery",
      drop_lat: 24.71,
      drop_lng: 46.67,
      drop_address: "الرياض",
      delivery_fee: 11.5,
      delivery_snapshot_version: 1,
    },
  };

  test("buildFinancialIntent matches store line totals", () => {
    const intent = buildFinancialIntent([storeItem], 11.5, "mada");
    expect(intent.subtotal).toBe(100);
    expect(intent.delivery_fee).toBe(11.5);
    expect(intent.delivery_pending).toBe(false);
    expect(intent.grand_total).toBe(128.22);
    expect(intent.payment_method).toBe("mada");
  });

  test("resolveDeliveryFeeFromDraft prefers draft.totals.delivery", () => {
    const draft = {
      items: [storeItem],
      totals: { delivery: 9, delivery_pending: false },
    };
    expect(resolveDeliveryFeeFromDraft(draft)).toBe(9);
  });

  test("buildOrderCreatePayload includes coords for store delivery", () => {
    const draft = { items: [storeItem], payment_method: "mada", totals: { delivery: 11.5 } };
    const built = buildOrderCreatePayload(draft, "mada");
    expect(built.payload.items).toHaveLength(1);
    expect(built.payload.customer_lat).toBe(24.71);
    expect(built.payload.customer_lng).toBe(46.67);
    expect(built.payload.customer_address).toBe("الرياض");
    expect(built.payload.financial_intent.grand_total).toBe(128.22);
  });

  test("buildOrderCreatePayload sets ew_pay paid flags", () => {
    const draft = { items: [storeItem], totals: { delivery: 11.5 } };
    const built = buildOrderCreatePayload(draft, "ew_pay");
    expect(built.payload.paid).toBe(true);
    expect(built.payload.payment_status).toBe("paid");
  });

  test("needsDeliveryCoords false for pickup", () => {
    const pickup = {
      ...storeItem,
      data: { ...storeItem.data, fulfillment_mode: "pickup", drop_lat: null, drop_lng: null },
    };
    expect(needsDeliveryCoords([pickup])).toBe(false);
  });

  test("resolvePostCheckoutRedirectUrl tracks single delivery order", () => {
    const url = resolvePostCheckoutRedirectUrl([{ id: "ord-1", drop_lat: 24.7, drop_lng: 46.6 }]);
    expect(url).toBe("/track?id=ord-1");
  });
});
