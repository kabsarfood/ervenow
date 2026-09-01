const { tryClaimSettlement, claimSettlement, SETTLEMENT_KINDS } = require("../../shared/services/settlementGuard");

describe("settlementGuard P1-03 fail-closed", () => {
  test("proceeds when RPC returns true", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(true);
  });

  test("skips when RPC returns false (duplicate)", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(false);
  });

  test("FAIL CLOSED when settlement_log missing", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "settlement_log" does not exist' },
      }),
    };
    const out = await claimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(out.proceed).toBe(false);
    expect(out.reason).toBe("schema_missing");
  });

  test("FAIL CLOSED on RPC exception / timeout", async () => {
    const sb = {
      rpc: jest.fn().mockRejectedValue(new Error("timeout")),
    };
    const out = await claimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(out.proceed).toBe(false);
    expect(out.reason).toBe("exception");
  });

  test("FAIL CLOSED on generic RPC error", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } }),
    };
    const ok = await tryClaimSettlement(sb, "11111111-1111-4111-8111-111111111111", "order", SETTLEMENT_KINDS.LEDGER_DELIVERED);
    expect(ok).toBe(false);
  });
});
