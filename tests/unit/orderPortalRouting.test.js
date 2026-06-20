const {
  resolveOrderPortalType,
  applyPortalTypeToOrderRow,
  orderVisibleInPortal,
  filterOrdersForPortal,
} = require("../../shared/utils/orderPortalRouting");

describe("orderPortalRouting", () => {
  test("resolves merchant orders", () => {
    expect(resolveOrderPortalType({ order_type: "restaurant", store_id: "s1" })).toBe("merchant");
    expect(resolveOrderPortalType({ order_type: "store" })).toBe("merchant");
    expect(resolveOrderPortalType({ order_type: "delivery" })).toBe("merchant");
  });

  test("resolves service vs transport", () => {
    expect(resolveOrderPortalType({ order_type: "service", service_type: "electrician" })).toBe("service");
    expect(resolveOrderPortalType({ order_type: "service", service_type: "pickup_truck" })).toBe("transport");
    expect(resolveOrderPortalType({ order_type: "gas_delivery", service_type: "gas_delivery" })).toBe("service");
    expect(
      resolveOrderPortalType({
        order_type: "service",
        service_type: "internal_delivery",
      })
    ).toBe("driver");
    expect(
      resolveOrderPortalType({
        order_type: "service",
        data: { service_type: "car_transport" },
      })
    ).toBe("transport");
  });

  test("applyPortalTypeToOrderRow stamps row and data", () => {
    const row = applyPortalTypeToOrderRow({ order_type: "store", store_id: "x" });
    expect(row.portal_type).toBe("merchant");
    expect(row.data.portal_type).toBe("merchant");
  });

  test("visibility rules per portal", () => {
    const merchantOrder = { order_type: "restaurant", store_id: "s1" };
    const serviceOrder = { order_type: "service", service_type: "plumber" };
    const transportOrder = { order_type: "service", service_type: "car_transport" };

    expect(orderVisibleInPortal(merchantOrder, "merchant")).toBe(true);
    expect(orderVisibleInPortal(merchantOrder, "service")).toBe(false);
    expect(orderVisibleInPortal(merchantOrder, "driver")).toBe(true);
    expect(orderVisibleInPortal(merchantOrder, "customer")).toBe(true);

    expect(orderVisibleInPortal(serviceOrder, "service")).toBe(true);
    expect(orderVisibleInPortal(serviceOrder, "transport")).toBe(false);
    expect(orderVisibleInPortal(serviceOrder, "driver")).toBe(false);

    expect(orderVisibleInPortal(transportOrder, "transport")).toBe(true);
    expect(orderVisibleInPortal(transportOrder, "service")).toBe(false);

    const driverOrder = { order_type: "service", service_type: "internal_delivery" };
    expect(orderVisibleInPortal(driverOrder, "driver")).toBe(true);
    expect(orderVisibleInPortal(driverOrder, "transport")).toBe(false);
    expect(orderVisibleInPortal(driverOrder, "service")).toBe(false);

    const gasOrder = { order_type: "gas_delivery", service_type: "gas_delivery" };
    expect(orderVisibleInPortal(gasOrder, "service")).toBe(true);
    expect(orderVisibleInPortal(gasOrder, "transport")).toBe(false);
    expect(orderVisibleInPortal(gasOrder, "driver")).toBe(false);
  });

  test("filterOrdersForPortal", () => {
    const rows = [
      { order_type: "store" },
      { order_type: "service", service_type: "plumber" },
      { order_type: "service", service_type: "pickup_truck" },
    ];
    expect(filterOrdersForPortal(rows, "service")).toHaveLength(1);
    expect(filterOrdersForPortal(rows, "transport")).toHaveLength(1);
    expect(filterOrdersForPortal(rows, "merchant")).toHaveLength(1);
  });
});
