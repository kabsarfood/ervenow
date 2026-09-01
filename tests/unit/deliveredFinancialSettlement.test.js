const { runDeliveredFinancialSettlement } = require("../../shared/services/deliveredFinancialSettlement");

function platformWalletFrom() {
  return jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        limit: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { id: "platform-w" }, error: null })),
        })),
      })),
    })),
  }));
}

describe("deliveredFinancialSettlement P1-03", () => {
  test("does not settle when claim is already taken (no double settlement)", async () => {
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const sb = { rpc, from: jest.fn() };
    const out = await runDeliveredFinancialSettlement(
      sb,
      { id: "order-1", driver_id: "drv-1", delivery_fee: 25, driver_earning: 20 },
      "test"
    );
    expect(out.settlement.reason).toBe("already_settled");
    expect(rpc).not.toHaveBeenCalledWith("ervenow_ledger_settle_delivered_order", expect.anything());
  });

  test("RPC success after claim", async () => {
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") return Promise.resolve({ data: true, error: null });
      if (name === "ervenow_ledger_settle_delivered_order") {
        return Promise.resolve({ data: { ok: true, driver: 25 }, error: null });
      }
      if (name === "ervenow_ledger_credit") return Promise.resolve({ data: { ok: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const sb = { rpc, from: platformWalletFrom() };
    const out = await runDeliveredFinancialSettlement(
      sb,
      { id: "order-1", driver_id: "drv-1", delivery_fee: 25, driver_earning: 20 },
      "test"
    );
    expect(out.settlement.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ervenow_ledger_settle_delivered_order", { p_order_id: "order-1" });
    expect(out.driver_credit.reason).toBe("settled_via_rpc");
  });

  test("RPC error releases claim and does not credit", async () => {
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") return Promise.resolve({ data: true, error: null });
      if (name === "ervenow_ledger_settle_delivered_order") {
        return Promise.resolve({ data: null, error: { message: "timeout" } });
      }
      if (name === "settlement_log_release_claim") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const sb = { rpc, from: platformWalletFrom() };
    const out = await runDeliveredFinancialSettlement(sb, { id: "order-fail", driver_id: "drv-1" }, "test");
    expect(out.settlement.ok).toBe(false);
    expect(out.driver_credit).toBeNull();
    expect(rpc).toHaveBeenCalledWith(
      "settlement_log_release_claim",
      expect.objectContaining({ p_entity_id: "order-fail" })
    );
  });

  test("credits driver via fallback when settle rpc returns zero driver", async () => {
    const sb = {
      rpc: jest.fn((name) => {
        if (name === "settlement_log_try_claim") return Promise.resolve({ data: true, error: null });
        if (name === "ervenow_ledger_settle_delivered_order") {
          return Promise.resolve({ data: { ok: true, driver: 0 }, error: null });
        }
        if (name === "ervenow_ledger_credit") {
          return Promise.resolve({ data: { ok: true, reason: "inserted" }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: platformWalletFrom(),
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
        if (name === "settlement_log_try_claim") return Promise.resolve({ data: true, error: null });
        if (name === "ervenow_ledger_settle_delivered_order") {
          return Promise.resolve({ data: { ok: true, driver: 0 }, error: null });
        }
        if (name === "ervenow_ledger_credit") return Promise.resolve({ data: { ok: true }, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
      from: platformWalletFrom(),
    };
    await runDeliveredFinancialSettlement(sb, { id: "order-3", provider_id: "prov-1", total_amount: 120 }, "test");
    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "prov-1",
      p_amount: 120,
      p_reference: "order-3",
      p_role: "service",
      p_reference_suffix: "provider_credit",
    });
  });

  test("concurrent claims: only first proceeds", async () => {
    let claimed = false;
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") {
        if (claimed) return Promise.resolve({ data: false, error: null });
        claimed = true;
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "ervenow_ledger_settle_delivered_order") {
        return Promise.resolve({ data: { ok: true, driver: 10 }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const sb = { rpc, from: platformWalletFrom() };
    const order = { id: "order-race", driver_id: "d1", delivery_fee: 10, driver_earning: 10 };
    const [a, b] = await Promise.all([
      runDeliveredFinancialSettlement(sb, order, "a"),
      runDeliveredFinancialSettlement(sb, order, "b"),
    ]);
    const settled = [a, b].filter((x) => x.settlement && x.settlement.ok === true && !x.settlement.skipped);
    const skipped = [a, b].filter((x) => x.settlement && x.settlement.reason === "already_settled");
    expect(settled.length).toBe(1);
    expect(skipped.length).toBe(1);
  });
});
