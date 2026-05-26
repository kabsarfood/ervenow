const { runDeliveredFinancialSettlement } = require("../../shared/services/deliveredFinancialSettlement");

describe("deliveredFinancialSettlement", () => {
  test("calls settle_delivered_order once when claim proceeds", async () => {
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "ervenow_ledger_settle_delivered_order") {
        return Promise.resolve({ data: { ok: true, driver: 25 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const sb = { rpc };

    const out = await runDeliveredFinancialSettlement(
      sb,
      { id: "order-1", driver_id: "drv-1", delivery_fee: 25 },
      "test"
    );

    expect(out.settlement.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ervenow_ledger_settle_delivered_order", { p_order_id: "order-1" });
    expect(rpc).not.toHaveBeenCalledWith("ervenow_ledger_credit", expect.anything());
  });

  test("credits provider when provider_id present", async () => {
    const sb = {
      rpc: jest.fn((name) => {
        if (name === "settlement_log_try_claim") {
          return Promise.resolve({ data: true, error: null });
        }
        if (name === "ervenow_ledger_settle_delivered_order") {
          return Promise.resolve({ data: { ok: true, driver: 0 }, error: null });
        }
        if (name === "ervenow_ledger_credit") {
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    await runDeliveredFinancialSettlement(
      sb,
      { id: "order-2", provider_id: "prov-1", total_amount: 120 },
      "test"
    );

    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "prov-1",
      p_amount: 120,
      p_reference: "order-2",
      p_role: "service",
      p_reference_suffix: "provider_credit",
    });
  });
});
