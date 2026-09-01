/**
 * HOTFIX-001 — مسار checkout → paid → delivered: إيداع تاجر واحد فقط.
 */
const { runDeliveredFinancialSettlement } = require("../../shared/services/deliveredFinancialSettlement");

jest.mock("../../shared/utils/ledgerWallet", () => ({
  ledgerDepositForUser: jest.fn(async () => ({ ok: true, reason: "inserted" })),
}));

const { ledgerDepositForUser } = require("../../shared/utils/ledgerWallet");

describe("merchant deposit flow (HOTFIX-001)", () => {
  test("paid store order: single merchant deposit at delivered, not at checkout path", async () => {
    ledgerDepositForUser.mockClear();

    const orderId = "11111111-1111-1111-1111-111111111111";
    const rpc = jest.fn((name) => {
      if (name === "settlement_log_try_claim") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "ervenow_ledger_settle_delivered_order") {
        return Promise.resolve({
          data: { ok: true, driver: 20, platform: 7, merchant: 0, ew_pay: false },
          error: null,
        });
      }
      if (name === "ervenow_ledger_credit") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const from = jest.fn((table) => {
      if (table === "ervenow_ledger_wallets") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: "platform-w" }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "ervenow_ledger_transactions") {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "stores") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { phone: "966509999999" }, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "merch-1", role: "merchant" }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      };
    });

    const sb = { rpc, from };

    const order = {
      id: orderId,
      store_id: "store-1",
      order_total: 100,
      platform_fee: 7,
      delivery_fee: 20,
      total_amount: 138,
      payment_status: "paid",
      payment_method: "mada",
      driver_id: "drv-1",
      driver_earning: 20,
    };

    const out = await runDeliveredFinancialSettlement(sb, order, "test:delivered");

    expect(out.settlement.ok).toBe(true);
    expect(out.merchant_credit.ok).toBe(true);
    expect(out.merchant_credit.amount).toBe(93);
    expect(ledgerDepositForUser).toHaveBeenCalledTimes(1);
    expect(ledgerDepositForUser.mock.calls[0][4]).toBe(`order:${orderId}:merchant_net`);
  });

  test("legacy SQL merchant ref blocks second Node deposit (HOTFIX-001 guard)", async () => {
    ledgerDepositForUser.mockClear();

    const orderId = "22222222-2222-2222-2222-222222222222";
    const sb = {
      rpc: jest.fn((name) => {
        if (name === "settlement_log_try_claim") {
          return Promise.resolve({ data: true, error: null });
        }
        if (name === "ervenow_ledger_settle_delivered_order") {
          return Promise.resolve({
            data: { ok: true, driver: 20, platform: 7, merchant: 80, ew_pay: false },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: jest.fn((table) => {
        if (table === "ervenow_ledger_wallets") {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { id: "platform-w" }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "ervenow_ledger_transactions") {
          return {
            select: () => ({
              in: () => ({
                eq: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [{ id: "legacy-tx", reference_id: `order:${orderId}:merchant` }],
                      error: null,
                    }),
                }),
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
    };

    const out = await runDeliveredFinancialSettlement(
      sb,
      {
        id: orderId,
        store_id: "store-1",
        order_total: 100,
        platform_fee: 7,
        delivery_fee: 20,
        payment_method: "mada",
        driver_id: "drv-1",
      },
      "test:legacy-guard"
    );

    expect(out.merchant_credit.reason).toBe("duplicate");
    expect(ledgerDepositForUser).not.toHaveBeenCalled();
  });
});
