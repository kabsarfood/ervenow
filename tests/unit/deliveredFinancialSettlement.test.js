const {
  runDeliveredFinancialSettlement,
} = require("../../shared/services/deliveredFinancialSettlement");

describe("deliveredFinancialSettlement", () => {
  test("always calls settle_delivered_order and driver credit fallback", async () => {
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") {
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "ervenow_ledger_settle_delivered_order") {
        return Promise.resolve({ data: { ok: true, driver: 25 }, error: null });
      }
      if (name === "ervenow_ledger_credit") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const from = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          limit: jest.fn(() => ({
            maybeSingle: jest.fn(() =>
              Promise.resolve({ data: { id: "platform-w" }, error: null })
            ),
          })),
        })),
      })),
    }));

    const sb = { rpc, from };

    const out = await runDeliveredFinancialSettlement(
      sb,
      { id: "order-1", driver_id: "drv-1", delivery_fee: 25, driver_earning: 20 },
      "test"
    );

    expect(out.settlement.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ervenow_ledger_settle_delivered_order", { p_order_id: "order-1" });
    expect(out.driver_credit.ok).toBe(true);
    expect(out.driver_credit.reason).toBe("settled_via_rpc");
  });

  test("credits driver via fallback when settle rpc returns zero driver", async () => {
    const sb = {
      rpc: jest.fn((name, args) => {
        if (name === "settlement_log_try_claim") {
          return Promise.resolve({ data: true, error: null });
        }
        if (name === "ervenow_ledger_settle_delivered_order") {
          return Promise.resolve({ data: { ok: true, driver: 0 }, error: null });
        }
        if (name === "ervenow_ledger_credit") {
          return Promise.resolve({ data: { ok: true, reason: "inserted" }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            limit: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: { id: "platform-w" }, error: null })
              ),
            })),
          })),
        })),
      })),
    };

    const out = await runDeliveredFinancialSettlement(
      sb,
      { id: "order-2", driver_id: "drv-2", delivery_fee: 30, driver_earning: 27 },
      "test"
    );

    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "drv-2",
      p_amount: 27,
      p_reference: "order-2",
      p_role: "driver",
      p_reference_suffix: "earning",
    });
    expect(out.driver_credit.ok).toBe(true);
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
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            limit: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: { id: "platform-w" }, error: null })
              ),
            })),
          })),
        })),
      })),
    };

    await runDeliveredFinancialSettlement(
      sb,
      { id: "order-3", provider_id: "prov-1", total_amount: 120 },
      "test"
    );

    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "prov-1",
      p_amount: 120,
      p_reference: "order-3",
      p_role: "service",
      p_reference_suffix: "provider_credit",
    });
  });
});
