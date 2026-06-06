const {
  isMerchantDispatchOrder,
  isLegacyOpenOrderForDriver,
  isReadyQueueOrderForDriver,
  isActiveAssignedOrderForDriver,
  isCompletedOrderForDriver,
} = require("../../shared/utils/driverStoreHandoff");

describe("driverStoreHandoff", () => {
  test("isMerchantDispatchOrder detects store and restaurant", () => {
    expect(isMerchantDispatchOrder({ order_type: "store" })).toBe(true);
    expect(isMerchantDispatchOrder({ order_type: "restaurant" })).toBe(true);
    expect(isMerchantDispatchOrder({ order_type: "delivery", store_id: "s1" })).toBe(true);
    expect(isMerchantDispatchOrder({ order_type: "delivery" })).toBe(false);
  });

  test("pending store orders excluded from legacy open pool", () => {
    expect(
      isLegacyOpenOrderForDriver({ order_type: "store", delivery_status: "pending", driver_id: null })
    ).toBe(false);
    expect(
      isLegacyOpenOrderForDriver({ order_type: "delivery", delivery_status: "pending", driver_id: null })
    ).toBe(true);
  });

  test("ready merchant orders appear in ready queue", () => {
    expect(
      isReadyQueueOrderForDriver({ order_type: "restaurant", delivery_status: "ready", driver_id: null })
    ).toBe(true);
    expect(
      isReadyQueueOrderForDriver({ order_type: "delivery", delivery_status: "ready", driver_id: null })
    ).toBe(false);
  });

  test("active assigned includes picked_up", () => {
    const uid = "d1";
    expect(
      isActiveAssignedOrderForDriver(
        { driver_id: uid, delivery_status: "picked_up" },
        uid
      )
    ).toBe(true);
    expect(
      isCompletedOrderForDriver({ driver_id: uid, delivery_status: "delivered" }, uid)
    ).toBe(true);
  });
});
