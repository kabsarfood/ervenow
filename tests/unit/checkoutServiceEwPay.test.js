jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(),
}));

jest.mock("twilio", () => null);

jest.mock("../../queues/deliveryQueue", () => ({
  enqueueDeliveryJob: jest.fn(async () => {}),
}));

jest.mock("../../shared/utils/idempotency", () => ({
  insertOrdersResilient: jest.fn(),
}));

jest.mock("../../shared/utils/generateOrderNumber", () => ({
  allocateUniqueOrderNumber: jest.fn(async () => "ES-TEST-1"),
}));

jest.mock("../../shared/utils/orderDedup", () => ({
  fetchOrderByCustomerIdempotencyKey: jest.fn(async () => null),
  findRecentSimilarDeliveryOrder: jest.fn(async () => null),
  isIdempotencyKeyUniqueViolation: jest.fn(() => false),
}));

jest.mock("../../shared/services/ervenowPayCheckout", () => ({
  applyErvenowPayForCheckoutOrders: jest.fn(async () => ({ ok: true, paid: [{ order_id: "ord-1", amount: 115 }] })),
  isErvenowPayMethod: jest.fn((m) => String(m || "").toLowerCase() === "ew_pay"),
  resolveMerchantUserIdForStore: jest.fn(async () => "merchant-uuid"),
}));

jest.mock("../../shared/services/notificationService", () => ({
  createNotification: jest.fn(async () => {}),
}));

jest.mock("../../shared/utils/storeOrderPostCheckout", () => ({
  runStoreCheckoutSideEffects: jest.fn(async () => {}),
}));

jest.mock("../../shared/utils/checkoutDeliveryEngine", () => ({
  useCartDeliverySnapshot: jest.fn(() => false),
  resolveStoreCheckoutFromCartSnapshot: jest.fn(),
}));

jest.mock("../../shared/utils/routeDistance", () => ({
  routeKmWithRoughFallback: jest.fn(async () => 1.2),
  deliveryEtaMinutesFromKm: jest.fn(() => 15),
}));

const { runCheckoutInsert } = require("../../apps/checkout/service");
const { applyErvenowPayForCheckoutOrders } = require("../../shared/services/ervenowPayCheckout");
const { insertOrdersResilient } = require("../../shared/utils/idempotency");

describe("checkout service ew_pay", () => {
  test("runCheckoutInsert does not throw TDZ and calls ew_pay after insert", async () => {
    const insertedOrder = {
      id: "ord-1",
      store_id: "store-1",
      order_total: 100,
      total_with_vat: 115,
      payment_status: "pending",
    };

    insertOrdersResilient.mockResolvedValueOnce({ data: insertedOrder, error: null });

    const from = jest.fn((table) => {
      if (table === "stores") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: "store-1",
                      name: "مطعم",
                      phone: "966501234567",
                      lat: 24.7,
                      lng: 46.7,
                      address: "الرياض",
                      delivery_radius_km: 5,
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "orders") {
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: "merchant-uuid", role: "merchant" }, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });

    const sb = { from };

    const out = await runCheckoutInsert(
      sb,
      { id: "cust-1", role: "customer", phone: "966509876543" },
      {
        items: [
          {
            type: "restaurant",
            price: 100,
            data: { store_id: "store-1", product_id: "p1", qty: 1 },
          },
        ],
        payment_method: "ew_pay",
        customer_lat: 24.71,
        customer_lng: 46.71,
      },
      { applyPaymentGate: true }
    );

    if (!out.ok) throw new Error(out.message || JSON.stringify(out));
    expect(out.ok).toBe(true);
    expect(applyErvenowPayForCheckoutOrders).toHaveBeenCalledWith(
      sb,
      "cust-1",
      expect.arrayContaining([expect.objectContaining({ id: "ord-1" })]),
      expect.objectContaining({ financialIntent: undefined })
    );
  });
});
