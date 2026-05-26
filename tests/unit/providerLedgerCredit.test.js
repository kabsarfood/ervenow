const { creditProviderOnDelivered } = require("../../shared/services/providerLedgerCredit");

describe("providerLedgerCredit", () => {
  test("calls ervenow_ledger_credit when provider and total_amount exist", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: { ok: true, reason: "inserted" }, error: null }),
    };
    const order = {
      id: "order-1",
      provider_id: "prov-1",
      total_amount: 150.5,
    };

    const row = await creditProviderOnDelivered(sb, order, "test");
    expect(row.ok).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "prov-1",
      p_amount: 150.5,
      p_reference: "order-1",
    });
  });

  test("skips when provider_id missing", async () => {
    const sb = { rpc: jest.fn() };
    const row = await creditProviderOnDelivered(sb, { id: "o1", total_amount: 10 });
    expect(row.skipped).toBe(true);
    expect(row.reason).toBe("missing_provider_id");
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  test("skips when total_amount missing or zero", async () => {
    const sb = { rpc: jest.fn() };
    const row = await creditProviderOnDelivered(sb, { id: "o1", provider_id: "p1", total_amount: 0 });
    expect(row.skipped).toBe(true);
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  test("treats duplicate rpc as success", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: { ok: true, reason: "duplicate" }, error: null }),
    };
    const row = await creditProviderOnDelivered(sb, {
      id: "o2",
      provider_id: "p2",
      total_amount: 99,
    });
    expect(row.reason).toBe("duplicate");
  });
});
