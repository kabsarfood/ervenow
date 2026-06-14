const {
  repairInconsistentOrderFinancials,
  hasDoubledCarTransportFee,
} = require("../../shared/utils/orderTotals");

describe("repairInconsistentOrderFinancials", () => {
  test("ED-13-001 doubled car transport fee", () => {
    const broken = {
      order_number: "ED-13-001",
      order_total: 199,
      delivery_fee: 199,
      vat_amount: 59.7,
      total_with_vat: 457.7,
      data: { service_type: "car_transport" },
    };
    expect(hasDoubledCarTransportFee(broken)).toBe(true);
    const fixed = repairInconsistentOrderFinancials(broken);
    expect(fixed.order_total).toBe(0);
    expect(fixed.delivery_fee).toBe(199);
    expect(fixed.vat_amount).toBe(29.85);
    expect(fixed.total_with_vat).toBe(228.85);
  });

  test("leaves consistent orders unchanged", () => {
    const ok = {
      order_total: 50,
      delivery_fee: 20,
      vat_amount: 10.5,
      total_with_vat: 80.5,
      data: { service_type: "gas_delivery" },
    };
    expect(repairInconsistentOrderFinancials(ok)).toBe(ok);
  });
});
