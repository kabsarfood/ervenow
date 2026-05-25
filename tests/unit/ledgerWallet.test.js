const {
  aggregateLedgerTransactions,
  getWalletMePayload,
  getWalletPayloadWithLedgerFallback,
  getAdminFinanceSummaryFromLedger,
  computeFinancialAlertsFromLedger,
} = require("../../shared/utils/ledgerWallet");

jest.mock("../../shared/utils/operationalWallet", () => ({
  round2: (n) => Math.round(Number(n) * 100) / 100,
  getOperationalWalletPayload: jest.fn().mockResolvedValue({
    balance: 50,
    total_earned: 120,
    total_withdrawn: 10,
    wallet_mode: "operational",
    layer: "ervenow_wallets",
  }),
  listOperationalWalletTransactions: jest.fn().mockResolvedValue([
    { id: "legacy-tx-1", amount: 50, type: "earning", status: "completed", created_at: "2026-01-02" },
  ]),
}));

jest.mock("../../shared/services/autoFreeze", () => ({
  listAutoFreezeDashboardAlerts: jest.fn().mockResolvedValue([]),
}));

const { getOperationalWalletPayload } = require("../../shared/utils/operationalWallet");

function mockLedgerSb({ txs = [], lastTx = [] } = {}) {
  return {
    from: jest.fn((table) => {
      if (table === "ervenow_ledger_wallets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: "wallet-1" }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "ervenow_ledger_transactions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => {
                const aggregateResult = Promise.resolve({ data: txs, error: null });
                aggregateResult.order = () => ({
                  limit: () => Promise.resolve({ data: lastTx, error: null }),
                });
                return aggregateResult;
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      };
    }),
    rpc: jest.fn(),
  };
}

describe("ledgerWallet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("aggregateLedgerTransactions computes balance credit - debit", () => {
    const agg = aggregateLedgerTransactions([
      { direction: "credit", amount: 100, type: "earning" },
      { direction: "debit", amount: 20, type: "commission" },
      { direction: "credit", amount: 50, type: "deposit" },
    ]);
    expect(agg.balance).toBe(130);
    expect(agg.total_earned).toBe(150);
    expect(agg.total_commission).toBe(20);
  });

  test("getWalletMePayload uses ledger with last_transactions", async () => {
    const sb = mockLedgerSb({
      txs: [
        { type: "earning", direction: "credit", amount: 100 },
        { type: "commission", direction: "debit", amount: 15 },
      ],
      lastTx: [
        {
          id: "tx1",
          type: "earning",
          direction: "credit",
          amount: 100,
          status: "completed",
          created_at: "2026-01-01",
        },
      ],
    });

    const payload = await getWalletMePayload(sb, "user-1", "driver");
    expect(payload.source).toBe("ervenow_ledger");
    expect(payload.balance).toBe(85);
    expect(payload.last_transactions).toHaveLength(1);
  });

  test("getWalletMePayload returns empty ledger when no wallet row", async () => {
    const sb = {
      from: jest.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      })),
      rpc: jest.fn().mockResolvedValue({
        data: { ok: true, balance: 0, total_earned: 0, total_commission: 0, transaction_count: 0 },
        error: null,
      }),
    };

    const payload = await getWalletMePayload(sb, "user-2", "driver");
    expect(payload.source).toBe("ervenow_ledger");
    expect(payload.balance).toBe(0);
    expect(getOperationalWalletPayload).not.toHaveBeenCalled();
  });

  test("uses ledger when has_data via getWalletPayloadWithLedgerFallback", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          ok: true,
          balance: 80,
          total_earned: 100,
          total_commission: 20,
          transaction_count: 3,
          wallet_id: "w1",
        },
        error: null,
      }),
    };

    const payload = await getWalletPayloadWithLedgerFallback(sb, "user-1", "driver");
    expect(payload.source).toBe("ervenow_ledger");
    expect(payload.balance).toBe(80);
    expect(getOperationalWalletPayload).not.toHaveBeenCalled();
  });

  test("getWalletPayloadWithLedgerFallback returns zero when ledger empty", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          ok: true,
          balance: 0,
          total_earned: 0,
          total_commission: 0,
          transaction_count: 0,
        },
        error: null,
      }),
    };

    const payload = await getWalletPayloadWithLedgerFallback(sb, "user-2", "driver");
    expect(payload.source).toBe("ervenow_ledger");
    expect(payload.balance).toBe(0);
    expect(getOperationalWalletPayload).not.toHaveBeenCalled();
  });

  test("admin finance summary from ledger rpc", async () => {
    const sb = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          platform_commission_total: 700,
          driver_earnings_total: 5000,
          service_commission_total: 210,
          store_earnings_total: 9000,
        },
        error: null,
      }),
      from: jest.fn((table) => {
        if (table === "platform_feature_flags") {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [{ key: "auto_freeze", mode: 2, config: { warn_threshold: 50, freeze_threshold: 100 } }],
                  error: null,
                }),
            }),
          };
        }
        if (table === "ervenow_ledger_transactions") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "tx-1",
                          type: "commission",
                          direction: "credit",
                          amount: 70,
                          reference_id: "order-1",
                          created_at: "2026-01-01T00:00:00Z",
                          wallet: { user_id: null, role: "platform", is_platform: true },
                        },
                      ],
                      error: null,
                    }),
                }),
                eq: () => ({
                  gt: () => ({
                    gte: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                }),
                gte: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === "ervenow_ledger_wallets") {
          return {
            select: () => ({
              not: () => ({
                lt: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "withdraw_requests") {
          return {
            select: () => ({
              gt: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const summary = await getAdminFinanceSummaryFromLedger(sb);
    expect(summary.ok).toBe(true);
    expect(summary.platform_commission_total).toBe(700);
    expect(summary.driver_earnings_total).toBe(5000);
    expect(summary.source).toBe("ervenow_ledger");
    expect(summary.recent_transactions).toHaveLength(1);
    expect(summary.recent_transactions[0].user_id).toBe("platform");
    expect(summary.recent_transactions[0].direction).toBe("credit");
    expect(summary.financial_alerts).toEqual([]);
  });

  test("computeFinancialAlertsFromLedger detects high debt and large withdrawal", async () => {
    const sb = {
      from: jest.fn((table) => {
        if (table === "ervenow_ledger_wallets") {
          return {
            select: () => ({
              not: () => ({
                lt: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [{ id: "w1", user_id: "user-debt", role: "driver", balance: -450 }],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "withdraw_requests") {
          return {
            select: () => ({
              gt: () => ({
                in: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: "wr-1",
                            user_id: "user-w",
                            amount: 1500,
                            status: "pending",
                            created_at: "2026-01-01T00:00:00Z",
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "ervenow_ledger_transactions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    gte: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                }),
                gte: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const alerts = await computeFinancialAlertsFromLedger(sb);
    expect(alerts.some((a) => a.type === "high_debt" && a.severity === "danger")).toBe(true);
    expect(alerts.some((a) => a.type === "large_withdrawal" && a.severity === "warn")).toBe(true);
  });
});
