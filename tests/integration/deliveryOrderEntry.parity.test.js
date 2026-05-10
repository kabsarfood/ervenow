/**
 * Phase 2 — Step 1: تكامل منطقي لمساري إنشاء التوصيل الموحّدين.
 * يختبر runUnifiedDeliveryOnlyCreate مع mock لـ createDeliveryOrderFromBody (بدون Supabase حقيقي).
 */
jest.mock("../../queues/deliveryQueue", () => ({
  enqueueDeliveryJob: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../shared/utils/deliveryOrdersListCache", () => ({
  bumpDeliveryOrdersListEpoch: jest.fn().mockResolvedValue(undefined),
}));

const mockCreateDeliveryOrderFromBody = jest.fn();

jest.mock("../../apps/delivery/service", () => {
  const actual = jest.requireActual("../../apps/delivery/service");
  return {
    ...actual,
    createDeliveryOrderFromBody: (...args) => mockCreateDeliveryOrderFromBody(...args),
  };
});

const { runUnifiedDeliveryOnlyCreate } = require("../../apps/order/deliveryOrderCreateShared");

function chainQuery(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => result,
    insert: () => builder,
    single: async () => result,
  };
  return builder;
}

function makeSupabaseMock() {
  return {
    from() {
      return chainQuery({ data: null, error: null });
    },
  };
}

const baseBody = () => ({
  pickup_address: "A",
  drop_address: "B",
  pickup_lat: 24.7,
  pickup_lng: 46.6,
  drop_lat: 24.8,
  drop_lng: 46.7,
  delivery_fee: 22,
  order_total: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ERVENOW_REQUIRE_ORDER_PAYMENT;
  mockCreateDeliveryOrderFromBody.mockImplementation(async (_sb, _user, body, opts) => ({
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      order_number: "ED-01-001",
      delivery_fee: Number(body.delivery_fee) || 0,
      delivery_status: opts.initialDeliveryStatus === "draft" ? "draft" : "pending",
      payment_status: opts.payment_status || null,
      pickup_lat: body.pickup_lat,
      pickup_lng: body.pickup_lng,
      drop_lat: body.drop_lat,
      drop_lng: body.drop_lng,
      series_source: body.series_source || null,
    },
    error: null,
  }));
});

describe("runUnifiedDeliveryOnlyCreate — parity delivery vs order", () => {
  const appUser = { id: "22222222-2222-4222-8222-222222222222", phone: "0500000000" };

  test("same coordinates → same delivery_fee and order_number (gate off)", async () => {
    const sb = makeSupabaseMock();
    const body = baseBody();

    const rDelivery = await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser,
      body: { ...body },
      idempotencyKey: null,
      xSourceHeader: null,
      entryPoint: "delivery",
    });
    const rOrder = await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser,
      body: { ...body },
      idempotencyKey: null,
      xSourceHeader: null,
      entryPoint: "order",
    });

    expect(rDelivery.ok && rOrder.ok).toBe(true);
    expect(rDelivery.order.delivery_fee).toBe(rOrder.order.delivery_fee);
    expect(rDelivery.order.order_number).toBe(rOrder.order.order_number);
    expect(rDelivery.order.pickup_lat).toBe(rOrder.order.pickup_lat);
    expect(rDelivery.order.drop_lng).toBe(rOrder.order.drop_lng);

    const optsDelivery = mockCreateDeliveryOrderFromBody.mock.calls[0][3];
    const optsOrder = mockCreateDeliveryOrderFromBody.mock.calls[1][3];
    expect(optsDelivery).toEqual({ initialDeliveryStatus: "pending", payment_status: "pending" });
    expect(optsOrder).toEqual({ initialDeliveryStatus: "pending", payment_status: "pending" });
  });

  test("delivery entry ignores payment gate; order entry respects draft when unpaid", async () => {
    process.env.ERVENOW_REQUIRE_ORDER_PAYMENT = "1";
    const sb = makeSupabaseMock();
    const body = baseBody();

    await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser,
      body: { ...body },
      idempotencyKey: null,
      xSourceHeader: null,
      entryPoint: "delivery",
    });
    await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser,
      body: { ...body },
      idempotencyKey: null,
      xSourceHeader: null,
      entryPoint: "order",
    });

    const optsDelivery = mockCreateDeliveryOrderFromBody.mock.calls[0][3];
    const optsOrder = mockCreateDeliveryOrderFromBody.mock.calls[1][3];
    expect(optsDelivery).toEqual({ initialDeliveryStatus: "pending", payment_status: "pending" });
    expect(optsOrder).toEqual({ initialDeliveryStatus: "draft", payment_status: "pending" });
    delete process.env.ERVENOW_REQUIRE_ORDER_PAYMENT;
  });

  test("X-Source + default series_source only for delivery entry", async () => {
    const sb = makeSupabaseMock();
    const body = baseBody();

    await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser,
      body: { ...body },
      idempotencyKey: null,
      xSourceHeader: "ios-app",
      entryPoint: "delivery",
    });
    await runUnifiedDeliveryOnlyCreate({
      sb,
      appUser,
      body: { ...body },
      idempotencyKey: null,
      xSourceHeader: "ios-app",
      entryPoint: "order",
    });

    const bodyDelivery = mockCreateDeliveryOrderFromBody.mock.calls[0][2];
    const bodyOrder = mockCreateDeliveryOrderFromBody.mock.calls[1][2];
    expect(bodyDelivery.series_source).toBe("ios-app");
    expect(bodyOrder.series_source).toBeUndefined();
  });
});
