jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: jest.fn() })),
}));

jest.mock("twilio", () => null);

const { runStoreCheckoutSideEffects } = require("../../shared/utils/storeOrderPostCheckout");
const { ledgerDepositForUser } = require("../../shared/utils/ledgerWallet");

jest.mock("../../shared/utils/ledgerWallet", () => ({
  ledgerDepositForUser: jest.fn(),
}));

describe("storeOrderPostCheckout (HOTFIX-001)", () => {
  beforeEach(() => {
    ledgerDepositForUser.mockClear();
  });

  test("does not ledger-deposit merchant on paid checkout", async () => {
    await runStoreCheckoutSideEffects({
      order: {
        id: "ord-1",
        store_id: "store-1",
        order_total: 100,
        payment_status: "paid",
        payment_method: "mada",
      },
      groupItems: [{ title: "منتج" }],
      storeRow: { phone: "966501234567", name: "متجر" },
    });

    expect(ledgerDepositForUser).not.toHaveBeenCalled();
  });

  test("does not ledger-deposit on ew_pay at checkout", async () => {
    await runStoreCheckoutSideEffects({
      order: {
        id: "ord-2",
        store_id: "store-1",
        order_total: 50,
        payment_status: "pending",
        payment_method: "ew_pay",
      },
      groupItems: [],
      storeRow: { phone: "966501234567" },
    });

    expect(ledgerDepositForUser).not.toHaveBeenCalled();
  });
});
