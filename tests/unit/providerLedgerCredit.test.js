const {
  creditProviderOnDelivered,
  resolveProviderCreditAmount,
} = require("../../shared/services/providerLedgerCredit");

describe("providerLedgerCredit", () => {
  test("resolveProviderCreditAmount uses data.provider_net when present", () => {
    const order = {
      total_amount: 900,
      platform_commission: 63,
      data: { provider_net: 837 },
    };
    expect(resolveProviderCreditAmount(order)).toBe(837);
  });

  test("resolveProviderCreditAmount falls back to total minus commission", () => {
    expect(resolveProviderCreditAmount({ total_amount: 38, platform_commission: 2.66 })).toBe(35.34);
  });

  test("calls ervenow_ledger_credit with provider_net not total_amount", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: { ok: true, reason: "inserted" }, error: null }),
    };
    const order = {
      id: "order-1",
      provider_id: "prov-1",
      total_amount: 900,
      platform_commission: 63,
      data: { provider_net: 837 },
    };

    const row = await creditProviderOnDelivered(sb, order, "test");
    expect(row.ok).toBe(true);
    expect(row.amount).toBe(837);
    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_credit", {
      p_user_id: "prov-1",
      p_amount: 837,
      p_reference: "order-1",
      p_role: "service",
      p_reference_suffix: "provider_credit",
    });
  });

  test("skips when provider_id missing", async () => {
    const sb = { rpc: jest.fn() };
    const row = await creditProviderOnDelivered(sb, { id: "o1", total_amount: 10 });
    expect(row.skipped).toBe(true);
    expect(row.reason).toBe("missing_provider_id");
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  test("skips when credit amount missing or zero", async () => {
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
      platform_commission: 6.93,
      data: { provider_net: 92.07 },
    });
    expect(row.reason).toBe("duplicate");
    expect(row.amount).toBe(92.07);
  });
});
