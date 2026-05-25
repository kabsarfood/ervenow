const { tryClaimSettlement, SETTLEMENT_KINDS } = require("../../shared/services/settlementGuard");

describe("settlementGuard", () => {
  test("proceeds when RPC returns true", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith("settlement_log_try_claim", expect.objectContaining({
      p_settlement_kind: SETTLEMENT_KINDS.LEDGER_DELIVERED,
    }));
  });

  test("skips when RPC returns false (duplicate)", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(false);
  });

  test("blocks when settlement_log missing in ledger_only", async () => {
    const prev = process.env.FINANCE_MODE;
    process.env.FINANCE_MODE = "ledger_only";
    const sb = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "settlement_log" does not exist' },
      }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(false);
    if (prev === undefined) delete process.env.FINANCE_MODE;
    else process.env.FINANCE_MODE = prev;
  });

  test("proceeds when settlement_log missing in legacy mode", async () => {
    const prev = process.env.FINANCE_MODE;
    process.env.FINANCE_MODE = "legacy";
    const sb = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "settlement_log" does not exist' },
      }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(true);
    if (prev === undefined) delete process.env.FINANCE_MODE;
    else process.env.FINANCE_MODE = prev;
  });
});
