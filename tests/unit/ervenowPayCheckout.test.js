const {
  orderChargeAmount,
  resolveCheckoutGrandTotal,
  isLegacyInternalDeliveryDoubleFee,
} = require("../../shared/services/ervenowPayCheckout");
const { normalizeOrderFinancialsForInsert } = require("../../shared/utils/orderTotals");

describe("ervenowPayCheckout — internal_delivery amounts", () => {
  test("legacy internal_delivery rows do not double-count fee", () => {
    const legacy = {
      service_type: "internal_delivery",
      order_total: 41,
      delivery_fee: 41,
      total_amount: 41,
    };
    expect(isLegacyInternalDeliveryDoubleFee(legacy)).toBe(true);
    expect(orderChargeAmount(legacy)).toBe(47.15);
  });

  test("normalized internal_delivery row matches checkout grand total", () => {
    const row = normalizeOrderFinancialsForInsert({
      service_type: "internal_delivery",
      order_total: 0,
      delivery_fee: 41,
      total_amount: 41,
    });
    expect(row.total_with_vat).toBe(47.15);
    expect(orderChargeAmount(row)).toBe(47.15);
  });

  test("resolveCheckoutGrandTotal accepts matching financial_intent", () => {
    const order = normalizeOrderFinancialsForInsert({
      service_type: "internal_delivery",
      order_total: 0,
      delivery_fee: 41,
      total_amount: 41,
    });
    const out = resolveCheckoutGrandTotal([order], { grand_total: 47.15 });
    expect(out.ok).toBe(true);
    expect(out.amount).toBe(47.15);
  });

  test("resolveCheckoutGrandTotal ignores client financial_intent", () => {
    const order = {
      service_type: "internal_delivery",
      order_total: 41,
      delivery_fee: 41,
      total_amount: 41,
    };
    const out = resolveCheckoutGrandTotal([order], { grand_total: 50 });
    expect(out.ok).toBe(true);
    expect(out.amount).toBe(47.15);
  });
});
