jest.mock("../../shared/services/driverCommissionLedger", () => ({
  assertDriverCanAcceptOrders: jest.fn(async () => {}),
}));

const { acceptOrder } = require("../../apps/delivery/service");
const { assertActorDeliveryTransition, isDriverRecordOffline } = require("../../shared/utils/closedAlphaTransitions");

describe("P1-05 driver assignment", () => {
  test("second concurrent accept loses when driver_id already set (optimistic filter)", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "o1",
                driver_id: null,
                delivery_status: "pending",
                order_type: "delivery",
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            is: () => ({
              in: () => ({
                select: () => ({
                  single: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const out = await acceptOrder(sb, "o1", "drv-2");
    expect(out.data).toBeNull();
  });

  test("cancelled order cannot be accepted", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: "o1", driver_id: null, delivery_status: "cancelled", order_type: "delivery" },
              error: null,
            }),
          }),
        }),
      }),
    };
    const out = await acceptOrder(sb, "o1", "drv-1");
    expect(String(out.error && out.error.message)).toMatch(/ملغي/);
  });

  test("repeated accept by same driver is idempotent", async () => {
    const order = { id: "o1", driver_id: "drv-1", delivery_status: "accepted", order_type: "delivery" };
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: order, error: null }),
          }),
        }),
      }),
    };
    const out = await acceptOrder(sb, "o1", "drv-1");
    expect(out.error).toBeNull();
    expect(out.data.driver_id).toBe("drv-1");
  });

  test("unauthorized scope (home service) is rejected", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "o1",
                driver_id: null,
                delivery_status: "pending",
                order_type: "service",
                service_type: "plumber",
              },
              error: null,
            }),
          }),
        }),
      }),
    };
    const out = await acceptOrder(sb, "o1", "drv-1");
    expect(String(out.error && out.error.message)).toMatch(/اختصاص/);
  });

  test("offline driver record is detected", () => {
    expect(isDriverRecordOffline({ status: "approved", active: true, availability: "offline" })).toBe(true);
    expect(isDriverRecordOffline({ status: "approved", active: true })).toBe(false);
    expect(isDriverRecordOffline({ status: "approved", active: false })).toBe(true);
  });
});

describe("P1-06 order transitions", () => {
  const driver = { id: "d1", role: "driver" };
  const merchant = { id: "m1", role: "merchant" };
  const customer = { id: "c1", role: "customer" };

  test("driver cannot skip pickup on store orders (accepted → delivered)", () => {
    const order = { store_id: "s1", order_type: "store" };
    const out = assertActorDeliveryTransition(order, driver, "accepted", "delivered");
    expect(out.ok).toBe(false);
  });

  test("merchant cannot mark delivered", () => {
    const out = assertActorDeliveryTransition({ store_id: "s1" }, merchant, "ready", "delivered");
    expect(out.ok).toBe(false);
  });

  test("customer cannot cancel after pickup", () => {
    const out = assertActorDeliveryTransition({ customer_id: "c1" }, customer, "picked_up", "cancelled");
    expect(out.ok).toBe(false);
  });

  test("cannot deliver a cancelled order", () => {
    const out = assertActorDeliveryTransition({}, driver, "cancelled", "delivered");
    expect(out.ok).toBe(false);
  });
});
