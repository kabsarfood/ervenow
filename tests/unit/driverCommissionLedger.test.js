const {
  resolveOrderPaymentMethod,
  resolveOrderBillableAmount,
  isCodOrder,
  COD_PAYMENT_METHODS,
} = require("../../shared/services/driverCommissionLedger");

describe("driverCommissionLedger", () => {
  test("resolveOrderPaymentMethod from column", () => {
    expect(resolveOrderPaymentMethod({ payment_method: "cash" })).toBe("cash");
  });

  test("resolveOrderPaymentMethod from data.paymentMethod", () => {
    expect(resolveOrderPaymentMethod({ data: { paymentMethod: "cod" } })).toBe("cod");
  });

  test("resolveOrderPaymentMethod prefers column over data", () => {
    expect(
      resolveOrderPaymentMethod({
        payment_method: "cash_on_delivery",
        data: { paymentMethod: "mada" },
      })
    ).toBe("cash_on_delivery");
  });

  test("isCodOrder accepts delivery", () => {
    expect(COD_PAYMENT_METHODS.has("delivery")).toBe(true);
    expect(isCodOrder({ payment_method: "delivery" })).toBe(true);
  });

  test("isCodOrder rejects online", () => {
    expect(isCodOrder({ payment_method: "mada" })).toBe(false);
  });

  test("resolveOrderBillableAmount from total_amount", () => {
    expect(resolveOrderBillableAmount({ total_amount: 115.5 })).toBe(115.5);
  });

  test("resolveOrderBillableAmount from data.total", () => {
    expect(resolveOrderBillableAmount({ data: { total: "99.25" } })).toBe(99.25);
  });

  test("resolveOrderBillableAmount from composed fields", () => {
    expect(
      resolveOrderBillableAmount({
        order_total: 80,
        delivery_fee: 15,
        vat_amount: 5,
      })
    ).toBe(100);
  });
});
