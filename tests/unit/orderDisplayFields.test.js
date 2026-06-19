const {
  breakdownFromOrder,
  storeNameFromOrder,
  isOrdersStoreNameColumnError,
  isOrdersBreakdownColumnError,
  isOrdersColumnError,
  enrichDriverOrderRow,
  enrichDriverOrderRows,
} = require("../../shared/utils/orderDisplayFields");

describe("orderDisplayFields", () => {
  test("storeNameFromOrder reads column then data", () => {
    expect(storeNameFromOrder({ store_name: "متجر أ" })).toBe("متجر أ");
    expect(storeNameFromOrder({ data: { store_name: "من data" } })).toBe("من data");
    expect(storeNameFromOrder({ breakdown: { merchant_name: "تاجر" } })).toBe("تاجر");
    expect(storeNameFromOrder({})).toBeNull();
  });

  test("breakdownFromOrder reads column then data.breakdown", () => {
    expect(breakdownFromOrder({ breakdown: { items: [1] } })).toEqual({ items: [1] });
    expect(breakdownFromOrder({ data: { breakdown: { fulfillment: "store_delivery" } } })).toEqual({
      fulfillment: "store_delivery",
    });
    expect(breakdownFromOrder({})).toEqual({});
  });

  test("enrichDriverOrderRow adds store_name and breakdown from data", () => {
    const row = enrichDriverOrderRow({
      id: "1",
      data: { store_name: "X", breakdown: { items: [] } },
    });
    expect(row.store_name).toBe("X");
    expect(row.breakdown).toEqual({ items: [] });
  });

  test("enrichDriverOrderRows maps array", () => {
    const rows = enrichDriverOrderRows([{ id: "1", data: { store_name: "Y" } }]);
    expect(rows[0].store_name).toBe("Y");
  });

  test("isOrdersColumnError helpers", () => {
    expect(isOrdersStoreNameColumnError({ message: "column orders.store_name does not exist" })).toBe(true);
    expect(isOrdersBreakdownColumnError({ message: "column orders.breakdown does not exist" })).toBe(true);
    expect(isOrdersColumnError({ message: "column orders.breakdown does not exist" }, "breakdown")).toBe(true);
    expect(isOrdersColumnError({ message: "other" }, "breakdown")).toBe(false);
  });
});
