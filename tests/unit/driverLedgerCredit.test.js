const {
  creditDriverOnDelivered,
  resolveDriverEarningAmount,
} = require("../../shared/services/driverLedgerCredit");

describe("driverLedgerCredit", () => {
  test("resolveDriverEarningAmount prefers driver_earning", () => {
    expect(resolveDriverEarningAmount({ driver_earning: 25, delivery_fee: 30 })).toBe(25);
  });

  test("resolveDriverEarningAmount uses delivery_fee minus platform_fee", () => {
    expect(resolveDriverEarningAmount({ delivery_fee: 30, platform_fee: 5 })).toBe(25);
  });

  test("creditDriverOnDelivered calls rpc with earning suffix", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: { ok: true, reason: "inserted" }, error: null }),
    };
    const order = {
      id: "order-1",
      driver_id: "drv-1",
      delivery_fee: 40,
      platform_fee: 7,
    };

    const row = await creditDriverOnDelivered(sb, order, {}, "test");
    expect(row.ok).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "drv-1",
      p_amount: 33,
      p_reference: "order-1",
      p_role: "driver",
      p_reference_suffix: "earning",
    });
  });

  test("skips rpc when settlement already credited driver", async () => {
    const sb = { rpc: jest.fn() };
    const row = await creditDriverOnDelivered(
      sb,
      { id: "o1", driver_id: "d1", delivery_fee: 10 },
      { ok: true, driver: 10 },
      "test"
    );
    expect(row.reason).toBe("settled_via_rpc");
    expect(sb.rpc).not.toHaveBeenCalled();
  });
});
