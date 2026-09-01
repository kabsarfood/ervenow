process.env.ERVENOW_JWT_SECRET = process.env.ERVENOW_JWT_SECRET || "p0-test-jwt-secret-16";

const jwt = require("jsonwebtoken");
const express = require("express");

jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(),
  getDatabaseConfigHint: () => "hint",
  getUrl: () => "http://example.supabase.co",
  getAnonKey: () => "anon-public-key",
}));

jest.mock("../../shared/services/whatsappService", () => ({
  sendOTP: jest.fn(async () => true),
}));

jest.mock("../../shared/utils/whatsapp", () => ({
  getLastWhatsAppError: () => null,
}));

jest.mock("../../shared/services/otpChallengeService", () => ({
  OTP_SCOPE: { CORE_LOGIN: "core_login" },
  otpBackendMode: () => "memory",
  startOtpChallenge: jest.fn(async () => ({ ok: true })),
  verifyOtpChallenge: jest.fn(async () => ({ ok: true })),
  invalidateOtpChallenge: jest.fn(async () => {}),
}));

const { createServiceClient } = require("../../shared/config/supabase");
const coreRouter = require("../../apps/core/routes");

function signUser(id, role, phone) {
  return jwt.sign({ sub: id, phone, role }, process.env.ERVENOW_JWT_SECRET, { expiresIn: "1h" });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/core", coreRouter);
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

describe("P0-01 POST /api/core/users/sync", () => {
  const customer = { id: "c1", role: "customer", status: "active", phone: "966501111111", name: "عميل" };

  beforeEach(() => {
    createServiceClient.mockReset();
    createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: customer, error: null }),
            single: async () => ({ data: customer, error: null }),
          }),
        }),
        upsert: () => ({
          select: () => ({
            single: async () => ({ data: { ...customer, role: "admin" }, error: null }),
          }),
        }),
      }),
    });
  });

  test("customer → admin body is rejected and does not write role", async () => {
    const token = signUser("c1", "customer", "966501111111");
    const app = makeApp();
    const { status, body } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/core/users/sync`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(String(body.error || "")).toMatch(/دور/);
  });

  test("sync without role is select-only and keeps customer", async () => {
    const token = signUser("c1", "customer", "966501111111");
    const app = makeApp();
    const { status, body } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/core/users/sync`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "966501111111" }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.profile.role).toBe("customer");
  });

  test("privileged internal roles in body are rejected", async () => {
    const token = signUser("c1", "customer", "966501111111");
    const app = makeApp();
    for (const role of ["merchant", "driver", "provider", "transport", "store"]) {
      const { status } = await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/core/users/sync`, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });
        return { status: res.status };
      });
      expect(status).toBe(403);
    }
  });
});
