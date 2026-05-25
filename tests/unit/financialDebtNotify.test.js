jest.mock("../../shared/utils/whatsapp", () => ({
  sendWhatsApp: jest.fn(async () => true),
}));

const { sendFinancialDebtWhatsApp, buildLogError } = require("../../shared/services/financialDebtNotify");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");

function mockSb({ recent = [], user = null, drivers = [] } = {}) {
  const notifChain = {
    select: jest.fn(() => notifChain),
    eq: jest.fn(() => notifChain),
    gte: jest.fn(() => notifChain),
    order: jest.fn(() => notifChain),
    limit: jest.fn(async () => ({ data: recent, error: null })),
    insert: jest.fn(async () => ({ error: null })),
  };
  return {
    from: jest.fn((table) => {
      if (table === "driver_notifications") return notifChain;
      if (table === "users") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data: user, error: null })),
            })),
          })),
        };
      }
      if (table === "drivers") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              limit: jest.fn(async () => ({ data: drivers, error: null })),
            })),
          })),
        };
      }
      return notifChain;
    }),
  };
}

describe("financialDebtNotify", () => {
  beforeEach(() => {
    sendWhatsApp.mockClear();
    process.env.ERVENOW_PUBLIC_URL = "https://ervenow.com";
  });

  test("buildLogError encodes kind and uid for throttle", () => {
    expect(buildLogError("warn", "uid-1")).toContain("kind:warn");
    expect(buildLogError("warn", "uid-1")).toContain("uid:uid-1");
  });

  test("throttles duplicate warn within 6h", async () => {
    const sb = mockSb({
      recent: [{ error: buildLogError("warn", "u1"), status: "sent", created_at: new Date().toISOString() }],
      user: { id: "u1", phone: "0500000001", role: "driver" },
      drivers: [{ id: "d1", phone: "500000001", name: "Test" }],
    });
    const r = await sendFinancialDebtWhatsApp(sb, { userId: "u1", amount: 80, kind: "warn" });
    expect(r.throttled).toBe(true);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  test("sends block when warn was sent but block is new kind", async () => {
    const sb = mockSb({
      recent: [{ error: buildLogError("warn", "u2"), status: "sent", created_at: new Date().toISOString() }],
      user: { id: "u2", phone: "0500000002", role: "driver" },
      drivers: [],
    });
    const r = await sendFinancialDebtWhatsApp(sb, { userId: "u2", amount: 120, kind: "block", phone: "0500000002" });
    expect(r.sent).toBe(true);
    expect(sendWhatsApp).toHaveBeenCalled();
    const body = sendWhatsApp.mock.calls[0][0].message;
    expect(body).toContain("إيقاف");
    expect(body).toContain("/pay?uid=u2");
  });
});
