const { refundPaidOrderOnLedger } = require("../../shared/services/ledgerCancelRefund");

describe("P0-03 ledger cancel refund", () => {
  test("unpaid order does not credit", async () => {
    const sb = { rpc: jest.fn() };
    const out = await refundPaidOrderOnLedger(sb, { id: "o1", payment_status: "pending" }, "c1");
    expect(out.refunded).toBe(false);
    expect(out.reason).toBe("not_paid");
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  test("refund once succeeds on ledger RPC — never ervenow_wallets", async () => {
    const sb = {
      rpc: jest.fn(async (name, args) => {
        expect(name).toBe("ervenow_ledger_refund_cancelled_order");
        expect(args.p_order_id).toBe("o1");
        expect(args.p_customer_id).toBe("c1");
        return { data: { ok: true, reason: "refunded", amount: 115 }, error: null };
      }),
    };
    const out = await refundPaidOrderOnLedger(
      sb,
      { id: "o1", payment_status: "paid", payment_method: "ew_pay", total_with_vat: 115 },
      "c1"
    );
    expect(out.refunded).toBe(true);
    expect(out.amount).toBe(115);
    expect(out.ledger).toBe("ervenow_ledger");
    expect(sb.rpc).toHaveBeenCalledTimes(1);
  });

  test("refund twice is idempotent (already_refunded)", async () => {
    const sb = {
      rpc: jest.fn(async () => ({
        data: { ok: true, reason: "already_refunded", amount: 115 },
        error: null,
      })),
    };
    const order = { id: "o1", payment_status: "paid", payment_method: "ew_pay" };
    const first = await refundPaidOrderOnLedger(sb, order, "c1");
    const second = await refundPaidOrderOnLedger(sb, order, "c1");
    expect(first.reason).toBe("already_refunded");
    expect(second.reason).toBe("already_refunded");
    expect(first.refunded).toBe(false);
    expect(second.refunded).toBe(false);
    expect(first.idempotent).toBe(true);
  });

  test("concurrent refunds both hit same idempotent RPC", async () => {
    let inflight = 0;
    const sb = {
      rpc: jest.fn(async () => {
        inflight += 1;
        await new Promise((r) => setTimeout(r, 5));
        inflight -= 1;
        return { data: { ok: true, reason: "already_refunded", amount: 50 }, error: null };
      }),
    };
    const order = { id: "o2", payment_status: "paid", payment_method: "ew_pay" };
    const [a, b] = await Promise.all([
      refundPaidOrderOnLedger(sb, order, "c1"),
      refundPaidOrderOnLedger(sb, order, "c1"),
    ]);
    expect(sb.rpc).toHaveBeenCalledTimes(2);
    expect(a.reason).toBe("already_refunded");
    expect(b.reason).toBe("already_refunded");
  });

  test("cancelled order refund uses order id + customer — not client amount", async () => {
    const sb = {
      rpc: jest.fn(async (_n, args) => {
        expect(args.p_amount).toBeUndefined();
        return { data: { ok: true, reason: "refunded", amount: 80 }, error: null };
      }),
    };
    await refundPaidOrderOnLedger(
      sb,
      { id: "o3", payment_status: "paid", payment_method: "ew_pay", total_with_vat: 999 },
      "c1"
    );
    expect(sb.rpc.mock.calls[0][1]).toEqual({ p_order_id: "o3", p_customer_id: "c1" });
  });

  test("settlement then refund is refused", async () => {
    const sb = {
      rpc: jest.fn(async () => ({
        data: { ok: false, reason: "already_settled" },
        error: null,
      })),
    };
    const out = await refundPaidOrderOnLedger(
      sb,
      { id: "o4", payment_status: "paid", payment_method: "ew_pay" },
      "c1"
    );
    expect(out.refunded).toBe(false);
    expect(out.reason).toBe("already_settled");
  });
});
