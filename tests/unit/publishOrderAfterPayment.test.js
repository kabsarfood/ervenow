jest.mock("../../shared/services/unifiedOrderStatus", () => ({
  afterStatusSideEffects: jest.fn(async () => {}),
}));

const { afterStatusSideEffects } = require("../../shared/services/unifiedOrderStatus");
const { publishDraftOrderAfterPayment } = require("../../shared/services/publishOrderAfterPayment");

describe("publishDraftOrderAfterPayment", () => {
  test("publishes draft service order after EW PAY and notifies providers", async () => {
    const order = {
      id: "ord-car-1",
      order_type: "service",
      service_type: "car_transport",
      delivery_status: "draft",
      payment_status: "paid",
      payment_method: "ew_pay",
    };

    const updated = { ...order, delivery_status: "pending" };

    const eq = jest.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: updated, error: null }),
      }),
    }));

    const sb = {
      from: () => ({
        update: () => ({
          eq: () => ({ eq, select: eq().select }),
        }),
      }),
    };

    const out = await publishDraftOrderAfterPayment(sb, order);

    expect(out.published).toBe(true);
    expect(out.order.delivery_status).toBe("pending");
    expect(afterStatusSideEffects).toHaveBeenCalledWith(
      sb,
      updated,
      "draft",
      "pending",
      {}
    );
  });

  test("skips when order is already pending", async () => {
    const sb = { from: jest.fn() };
    const out = await publishDraftOrderAfterPayment(sb, {
      id: "ord-2",
      delivery_status: "pending",
      payment_status: "paid",
    });
    expect(out.published).toBe(false);
    expect(out.reason).toBe("not_draft");
    expect(sb.from).not.toHaveBeenCalled();
  });

  test("skips when payment is not confirmed", async () => {
    const sb = { from: jest.fn() };
    const out = await publishDraftOrderAfterPayment(sb, {
      id: "ord-3",
      delivery_status: "draft",
      payment_status: "pending",
    });
    expect(out.published).toBe(false);
    expect(out.reason).toBe("not_paid");
    expect(sb.from).not.toHaveBeenCalled();
  });
});
