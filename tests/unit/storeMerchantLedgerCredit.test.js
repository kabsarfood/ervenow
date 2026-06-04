const {
  creditStoreMerchantOnDelivered,
  merchantDepositRefExists,
} = require("../../shared/services/storeMerchantLedgerCredit");
const { storeMerchantNetFromOrder } = require("../../shared/utils/storeMerchantNet");

jest.mock("../../shared/utils/ledgerWallet", () => ({
  ledgerDepositForUser: jest.fn(async () => ({ ok: true })),
}));

const { ledgerDepositForUser } = require("../../shared/utils/ledgerWallet");

describe("storeMerchantLedgerCredit (HOTFIX-001)", () => {
  test("storeMerchantNetFromOrder uses 7% on goods", () => {
    expect(storeMerchantNetFromOrder({ order_total: 100 })).toBe(93);
  });

  test("skips when legacy checkout ref already exists", async () => {
    const sb = {
      from: jest.fn((table) => {
        if (table === "ervenow_ledger_transactions") {
          return {
            select: () => ({
              in: () => ({
                eq: () => ({
                  limit: () =>
                    Promise.resolve({ data: [{ id: "tx-1" }], error: null }),
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }),
    };

    const out = await creditStoreMerchantOnDelivered(
      sb,
      { id: "o1", store_id: "s1", order_total: 100, payment_status: "paid" },
      {}
    );
    expect(out.reason).toBe("duplicate");
    expect(ledgerDepositForUser).not.toHaveBeenCalled();
  });

  test("deposits once at delivery with canonical ref", async () => {
    ledgerDepositForUser.mockClear();

    const sb = {
      from: jest.fn((table) => {
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
                  Promise.resolve({ data: { phone: "966501234567" }, error: null }),
              }),
            }),
          };
        }
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: "merchant-uuid", role: "merchant" }, error: null }),
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

    const out = await creditStoreMerchantOnDelivered(
      sb,
      {
        id: "order-uuid-1",
        store_id: "store-1",
        order_total: 200,
        payment_status: "paid",
        order_number: "E-100",
      },
      {}
    );

    expect(out.ok).toBe(true);
    expect(out.amount).toBe(186);
    expect(out.reference_id).toBe("order:order-uuid-1:merchant_net");
    expect(ledgerDepositForUser).toHaveBeenCalledTimes(1);
    expect(ledgerDepositForUser).toHaveBeenCalledWith(
      sb,
      "merchant-uuid",
      "merchant",
      186,
      "order:order-uuid-1:merchant_net",
      expect.stringContaining("E-100")
    );
  });

  test("merchantDepositRefExists detects legacy ref", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          in: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [{ id: "x" }], error: null }),
            }),
          }),
        }),
      }),
    };
    const exists = await merchantDepositRefExists(sb, ["store:order:o1:merchant_net"]);
    expect(exists).toBe(true);
  });
});
