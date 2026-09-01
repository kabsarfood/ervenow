process.env.ERVENOW_JWT_SECRET = process.env.ERVENOW_JWT_SECRET || "p1-debt-test-secret-16";

const jwt = require("jsonwebtoken");
const express = require("express");
const { createDebtPayToken } = require("../../shared/utils/debtPayToken");

jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(),
}));

jest.mock("../../shared/services/debtPaymentSettlement", () => ({
  resolveDebtSnapshot: jest.fn(async () => ({
    total_owed: 50,
    driver_owed: 50,
    ledger_owed: 50,
  })),
  getPaymentSession: jest.fn(),
  settleDebtPaymentSession: jest.fn(),
  findSessionByGatewayId: jest.fn(),
  isSessionsTableMissing: jest.fn(() => false),
}));

jest.mock("../../shared/services/autoFreeze", () => ({
  loadAutoFreezeSettings: jest.fn(async () => ({ auto: false, config: {}, mode: "off" })),
  evaluateAutoFreezeBalance: jest.fn(() => ({ phase: "none" })),
  toAutoFreezeBalance: jest.fn((n) => n),
}));

jest.mock("../../shared/utils/checkoutPaymentMethods", () => ({
  loadPlatformPaymentMethodsFromDb: jest.fn(async () => ({ ew_pay: true })),
}));

jest.mock("../../shared/services/paymentGateway", () => ({
  gatewayMode: jest.fn(() => "mock"),
  createPaymentCheckoutSession: jest.fn(async () => ({
    gateway: "mock",
    checkout_url: "http://pay.test/c",
    gateway_payment_id: "gp1",
    gateway_invoice_id: null,
  })),
  verifyWebhookPayment: jest.fn(),
}));

jest.mock("../../shared/services/auditLog", () => ({
  insertAuditEvent: jest.fn(async () => ({ ok: true })),
}));

const { createServiceClient } = require("../../shared/config/supabase");
const payRouter = require("../../apps/pay/routes");

function signUser(id, role) {
  return jwt.sign({ sub: id, phone: "966500000000", role }, process.env.ERVENOW_JWT_SECRET, { expiresIn: "1h" });
}

function userFrom(row) {
  return {
    from: (table) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        };
      }
      if (table === "debt_payment_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "sess-1", user_id: row && row.id, amount: 50, status: "pending", gateway: "mock" },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/pay", payRouter);
  return app;
}

function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        const out = await fn(port);
        server.close(() => resolve(out));
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

describe("P1-01 debt endpoints", () => {
  beforeEach(() => {
    createServiceClient.mockReset();
    createServiceClient.mockReturnValue(
      userFrom({ id: "u-debt", role: "driver", status: "active", phone: "966500000000" })
    );
  });

  test("anonymous creation without token → 401", async () => {
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/pay/create-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: "u-debt", amount: 50, type: "debt" }),
      });
      return { status: res.status };
    });
    expect(status).toBe(401);
  });

  test("anonymous debt-info without token → 401", async () => {
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/pay/debt-info?uid=u-debt`);
      return { status: res.status };
    });
    expect(status).toBe(401);
  });

  test("customer cannot open another user's debt", async () => {
    createServiceClient.mockReturnValue(
      userFrom({ id: "cust-1", role: "customer", status: "active", phone: "966501111111" })
    );
    const token = signUser("cust-1", "customer");
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/pay/debt-info?uid=u-other`, {
        headers: { Authorization: "Bearer " + token },
      });
      return { status: res.status };
    });
    expect(status).toBe(403);
  });

  test("manipulated user_id with own token is rejected", async () => {
    const token = createDebtPayToken("u-debt");
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/pay/create-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: "u-forged", amount: 50, type: "debt", token, wallet_id: "w-forged" }),
        }
      );
      return { status: res.status };
    });
    expect(status).toBe(403);
  });

  test("negative and zero amount rejected", async () => {
    const token = createDebtPayToken("u-debt");
    const app = makeApp();
    for (const amount of [-10, 0]) {
      const { status } = await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/pay/create-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: "u-debt", amount, type: "debt", token }),
        });
        return { status: res.status };
      });
      expect(status).toBe(400);
    }
  });

  test("signed token allows scoped self-service session", async () => {
    const token = createDebtPayToken("u-debt");
    const app = makeApp();
    const { status, body } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/pay/create-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: "u-debt", amount: 50, type: "debt", token }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(200);
    expect(body.session_id).toBe("sess-1");
  });
});
