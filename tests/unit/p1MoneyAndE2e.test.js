const { splitDeliveredOrder, assertNoNegativeMoney } = require("../../shared/utils/moneyInvariants");
const { refundPaidOrderOnLedger } = require("../../shared/services/ledgerCancelRefund");
const { repriceStoreCartItems } = require("../../shared/services/checkoutServerPricing");
const { denyClientRolePayload } = require("../../shared/utils/roleAssignment");

describe("P1-09 money invariants", () => {
  test("store order split reconstructs customer payment without creating money", () => {
    const split = splitDeliveredOrder({
      order_total: 100,
      delivery_fee: 10,
      vat_amount: 16.5,
      total_with_vat: 126.5,
      platform_fee: 7,
      driver_earning: 10,
    });
    expect(split.merchantNet).toBe(93);
    expect(split.driverEarning).toBe(10);
    expect(split.platformFee).toBe(7);
    expect(assertNoNegativeMoney(split)).toBe(true);
    expect(split.balanced).toBe(true);
  });

  test("no unexpected negative wallets in split", () => {
    const split = splitDeliveredOrder({ order_total: 0, delivery_fee: 0, total_with_vat: 0 });
    expect(assertNoNegativeMoney(split)).toBe(true);
  });
});

describe("P1-11 closed-alpha e2e (unit, test money only)", () => {
  test("checkout: client price 1 → catalog 100", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [{ id: "p1", store_id: "s1", price: 100, offer_price: null, active: true, name: "x" }],
              error: null,
            }),
          }),
        }),
      }),
    };
    const out = await repriceStoreCartItems(sb, "s1", [
      { type: "store", price: 1, data: { store_id: "s1", product_id: "p1", qty: 1 } },
    ]);
    expect(out.goodsTotal).toBe(100);
  });

  test("cancel refund twice does not double credit", async () => {
    const sb = {
      rpc: jest.fn(async () => ({ data: { ok: true, reason: "already_refunded", amount: 115 }, error: null })),
    };
    const order = { id: "o1", payment_status: "paid", payment_method: "ew_pay" };
    const a = await refundPaidOrderOnLedger(sb, order, "c1");
    const b = await refundPaidOrderOnLedger(sb, order, "c1");
    expect(a.refunded).toBe(false);
    expect(b.refunded).toBe(false);
    expect(a.reason).toBe("already_refunded");
  });

  test("privilege escalation body is still rejected", () => {
    expect(denyClientRolePayload({ role: "admin" }).status).toBe(403);
  });
});
