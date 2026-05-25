const {
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
  buildOrderStatusPatch,
} = require("../../shared/domain/orders/orderStatus");

describe("orderStatus unified", () => {
  test("getOrderDeliveryStatus uses delivery_status only", () => {
    expect(getOrderDeliveryStatus({ delivery_status: "delivered", status: "new" })).toBe("delivered");
    expect(getOrderDeliveryStatus({ status: "delivered" })).toBe("pending");
  });

  test("normalizeIncomingStatus maps legacy aliases", () => {
    expect(normalizeIncomingStatus("onroad")).toBe("delivering");
    expect(normalizeIncomingStatus("completed")).toBe("delivered");
  });

  test("buildOrderStatusPatch never sets status column", () => {
    const p = buildOrderStatusPatch("cancelled");
    expect(p.delivery_status).toBe("cancelled");
    expect(p.status).toBeUndefined();
    expect(p.cancelled_at).toBeTruthy();
  });
});
