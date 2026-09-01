const { handleUnifiedCartCheckoutHttp } = require("../../apps/order/cartCheckoutHttp");

jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(() => ({ __sb: true })),
}));

jest.mock("../../shared/utils/checkoutIdempotency", () => ({
  claimOrReplayCheckout: jest.fn(),
  finalizeCheckoutIdempotency: jest.fn(async () => {}),
  releaseCheckoutIdempotency: jest.fn(async () => {}),
}));

jest.mock("../../apps/checkout/service", () => ({
  runCheckoutInsert: jest.fn(),
}));

jest.mock("../../shared/utils/deliveryOrdersListCache", () => ({
  bumpDeliveryOrdersListEpoch: jest.fn(async () => {}),
}));

jest.mock("../../shared/utils/perfLog", () => ({
  perfLog: jest.fn(),
}));

jest.mock("../../shared/utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const { claimOrReplayCheckout, finalizeCheckoutIdempotency, releaseCheckoutIdempotency } = require("../../shared/utils/checkoutIdempotency");
const { runCheckoutInsert } = require("../../apps/checkout/service");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function mockReq(overrides = {}) {
  return {
    body: {
      items: [{ type: "store", price: 10, data: { store_id: "s1", product_id: "p1", qty: 1 } }],
      payment_method: "cash_on_delivery",
    },
    appUser: { id: "cust-1", role: "customer" },
    supabase: { __sb: true },
    headers: { "idempotency-key": "idem-test-key" },
    ...overrides,
  };
}

describe("handleUnifiedCartCheckoutHttp — idempotency release on 4xx", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    claimOrReplayCheckout.mockResolvedValue({ claimed: true });
    runCheckoutInsert.mockResolvedValue({
      ok: true,
      orders: [{ id: "ord-1", order_number: "1001" }],
    });
  });

  test("successful checkout finalizes idempotency and does not release", async () => {
    const req = mockReq();
    const res = mockRes();

    await handleUnifiedCartCheckoutHttp(req, res, { applyPaymentGate: true });

    expect(finalizeCheckoutIdempotency).toHaveBeenCalledWith(
      req.supabase,
      "cust-1",
      "idem-test-key",
      expect.objectContaining({ ok: true, orders: expect.any(Array) })
    );
    expect(releaseCheckoutIdempotency).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  test.each([
    [400, "cart validation failed"],
    [403, "forbidden checkout"],
    [422, "unprocessable checkout"],
  ])("releases idempotency before returning %i", async (status, message) => {
    runCheckoutInsert.mockResolvedValueOnce({ ok: false, message, status });
    const req = mockReq();
    const res = mockRes();

    await handleUnifiedCartCheckoutHttp(req, res, { applyPaymentGate: true });

    expect(releaseCheckoutIdempotency).toHaveBeenCalledWith(req.supabase, "cust-1", "idem-test-key");
    expect(finalizeCheckoutIdempotency).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, message }));
  });

  test("retry after 400 can claim again without 409 conflict", async () => {
    runCheckoutInsert
      .mockResolvedValueOnce({ ok: false, message: "حدد موقع التوصيل", status: 400 })
      .mockResolvedValueOnce({ ok: true, orders: [{ id: "ord-2" }] });

    claimOrReplayCheckout
      .mockResolvedValueOnce({ claimed: true })
      .mockResolvedValueOnce({ claimed: true });

    const req = mockReq();
    const res1 = mockRes();
    const res2 = mockRes();

    await handleUnifiedCartCheckoutHttp(req, res1, { applyPaymentGate: true });
    await handleUnifiedCartCheckoutHttp(req, res2, { applyPaymentGate: true });

    expect(releaseCheckoutIdempotency).toHaveBeenCalledTimes(1);
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(res2.status).not.toHaveBeenCalledWith(409);
  });

  test("409 conflict only when claim reports in-progress conflict", async () => {
    claimOrReplayCheckout.mockResolvedValueOnce({ conflict: true });
    const req = mockReq();
    const res = mockRes();

    await handleUnifiedCartCheckoutHttp(req, res, { applyPaymentGate: true });

    expect(runCheckoutInsert).not.toHaveBeenCalled();
    expect(releaseCheckoutIdempotency).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      message: "checkout already in progress for this key",
    });
  });
});
