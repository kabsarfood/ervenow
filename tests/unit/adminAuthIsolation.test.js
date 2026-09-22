process.env.ERVENOW_JWT_SECRET = process.env.ERVENOW_JWT_SECRET || "p0-test-jwt-secret-16";
process.env.ERVENOW_ADMIN_LOGIN_PHONE = "0505745650";
process.env.ERVENOW_ADMIN_FULL_PHONES = "0505745650";
process.env.ERVENOW_OTP_BACKEND = "memory";
process.env.ERVENOW_OTP_ALLOW_MEMORY = "1";

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const express = require("express");

jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: () => ({}) })),
  getDatabaseConfigHint: () => "hint",
  getUrl: () => "http://example.supabase.co",
  getAnonKey: () => "anon-public-key",
}));

jest.mock("../../shared/services/whatsappService", () => ({
  sendOTP: jest.fn(async (_digits, code) => {
    global.__lastOtpCode = code;
    return true;
  }),
}));

jest.mock("../../shared/utils/whatsapp", () => ({
  getLastWhatsAppError: () => null,
}));

jest.mock("../../shared/utils/liveMapPublicStore", () => ({
  readStateAsync: jest.fn(async () => true),
}));

jest.mock("../../shared/utils/userPhoneLookup", () => {
  const actual = jest.requireActual("../../shared/utils/userPhoneLookup");
  return {
    ...actual,
    findUserByPhoneResilient: jest.fn(async () => ({ data: null, error: null })),
  };
});

const { findUserByPhoneResilient } = require("../../shared/utils/userPhoneLookup");
const { sendOTP } = require("../../shared/services/whatsappService");
const coreRouter = require("../../apps/core/routes");
const adminAuthRouter = require("../../apps/admin/auth");
const {
  ADMIN_LOGIN_REQUIRED_CODE,
  ADMIN_LOGIN_REQUIRED_AR,
  ADMIN_NOT_AUTHORIZED_AR,
} = require("../../shared/utils/adminAuthMessages");

const PUBLIC = path.join(__dirname, "../../public");
const ADMIN_PHONE = "+966505745650";
const CUSTOMER_PHONE = "+966501111111";
const MERCHANT_PHONE = "+966502222222";

const adminRow = {
  id: "admin-1",
  role: "admin",
  status: "active",
  phone: "966505745650",
  name: "مدير",
};
const customerRow = {
  id: "cust-1",
  role: "customer",
  status: "active",
  phone: "966501111111",
  name: "عميل",
};
const merchantRow = {
  id: "store-1",
  role: "store",
  status: "active",
  phone: "966502222222",
  name: "متجر",
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/core", coreRouter);
  app.use("/api/admin/auth", adminAuthRouter);
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

async function postJson(port, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function readPublic(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), "utf8");
}

describe("Admin Authentication Isolation", () => {
  beforeEach(() => {
    global.__lastOtpCode = null;
    sendOTP.mockClear();
    findUserByPhoneResilient.mockReset();
    findUserByPhoneResilient.mockResolvedValue({ data: null, error: null });
  });

  test("admin send-otp + verify-otp issues admin session with auth_context", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: adminRow, error: null });
    const app = makeApp();
    const { token, payload } = await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/admin/auth/send-otp", { phone: ADMIN_PHONE });
      expect(sent.status).toBe(200);
      expect(sent.json.ok).toBe(true);
      expect(sendOTP).toHaveBeenCalled();
      expect(global.__lastOtpCode).toMatch(/^\d{5}$/);

      const verified = await postJson(port, "/api/admin/auth/verify-otp", {
        phone: ADMIN_PHONE,
        code: global.__lastOtpCode,
      });
      expect(verified.status).toBe(200);
      expect(verified.json.token).toBeTruthy();
      expect(verified.json.user.role).toBe("admin");
      expect(verified.json.auth_context).toBe("admin");
      expect(verified.json.redirect).toBe("/admin-dashboard");
      const decoded = jwt.verify(verified.json.token, process.env.ERVENOW_JWT_SECRET);
      return { token: verified.json.token, payload: decoded };
    });
    expect(payload.role).toBe("admin");
    expect(payload.auth_context).toBe("admin");
    expect(payload.sub).toBe("admin-1");
    expect(token).toBeTruthy();
  });

  test("customer on admin send-otp is rejected before WhatsApp", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: customerRow, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/admin/auth/send-otp", { phone: CUSTOMER_PHONE });
      expect(sent.status).toBe(403);
      expect(sent.json.ok).toBe(false);
      expect(sent.json.error).toBe(ADMIN_NOT_AUTHORIZED_AR);
      expect(String(sent.json.error)).not.toMatch(/ترقية/);
      expect(sendOTP).not.toHaveBeenCalled();
    });
  });

  test("merchant on admin send-otp is rejected before WhatsApp", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: merchantRow, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/admin/auth/send-otp", { phone: MERCHANT_PHONE });
      expect(sent.status).toBe(403);
      expect(sent.json.error).toBe(ADMIN_NOT_AUTHORIZED_AR);
      expect(sendOTP).not.toHaveBeenCalled();
    });
  });

  test("admin on public /login send-otp returns ADMIN_LOGIN_REQUIRED and sends no OTP", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: adminRow, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/core/send-otp", {
        phone: ADMIN_PHONE,
        login_only: true,
      });
      expect(sent.status).toBe(403);
      expect(sent.json.code).toBe(ADMIN_LOGIN_REQUIRED_CODE);
      expect(sent.json.admin_login_required).toBe(true);
      expect(sent.json.admin_login_path).toBe("/admin-login");
      expect(sent.json.error).toBe(ADMIN_LOGIN_REQUIRED_AR);
      expect(sent.json.token).toBeFalsy();
      expect(sendOTP).not.toHaveBeenCalled();
    });
  });

  test("admin on public /login verify-otp does not issue a session", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: adminRow, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const verified = await postJson(port, "/api/core/verify-otp", {
        phone: ADMIN_PHONE,
        code: "12345",
        login_only: true,
      });
      expect(verified.status).toBe(403);
      expect(verified.json.code).toBe(ADMIN_LOGIN_REQUIRED_CODE);
      expect(verified.json.token).toBeFalsy();
    });
  });

  test("public core send-otp with role=admin is rejected", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: adminRow, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/core/send-otp", {
        phone: ADMIN_PHONE,
        role: "admin",
      });
      expect(sent.status).toBe(403);
      expect(sent.json.code).toBe(ADMIN_LOGIN_REQUIRED_CODE);
      expect(sendOTP).not.toHaveBeenCalled();
    });
  });

  test("customer public login OTP is unchanged", async () => {
    findUserByPhoneResilient.mockResolvedValue({ data: customerRow, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/core/send-otp", {
        phone: CUSTOMER_PHONE,
        login_only: true,
      });
      expect(sent.status).toBe(200);
      expect(sent.json.ok).toBe(true);
      expect(sendOTP).toHaveBeenCalled();
    });
  });

  test("admin-login page uses isolated auth APIs and hard dashboard redirect", () => {
    const html = readPublic("admin-login.html");
    expect(html).toMatch(/\/api\/admin\/auth\/send-otp/);
    expect(html).toMatch(/\/api\/admin\/auth\/verify-otp/);
    expect(html).not.toMatch(/\/api\/core\/send-otp/);
    expect(html).not.toMatch(/\/api\/core\/verify-otp/);
    expect(html).toMatch(/location\.replace\("\/admin-dashboard"\)/);
    expect(html).not.toMatch(/ErvenowRoleRouting/);
    expect(html).not.toMatch(/أريد الطلب من ERVENOW/);
    expect(html).not.toMatch(/إنشاء عضوية/);
  });

  test("public login shows ADMIN_LOGIN_REQUIRED with admin-login link", () => {
    const html = readPublic("login.html");
    expect(html).toMatch(/ADMIN_LOGIN_REQUIRED|حساب إداري/);
    expect(html).toMatch(/href="\/admin-login"/);
    expect(html).toMatch(/\/api\/core\/send-otp/);
    expect(html).not.toMatch(/\/api\/admin\/auth\/send-otp/);
  });

  test("admin-dashboard hides console until admin session is confirmed", () => {
    const html = readPublic("admin/admin-dashboard.html");
    expect(html).toMatch(/admin-gate-pending/);
    expect(html).toMatch(/adminAuthGate/);
    expect(html).toMatch(/location\.replace\("\/admin-login"\)/);
    const settings = readPublic("admin/modules/settings.js");
    expect(settings).toMatch(/admin-gate-ready/);
    expect(settings).toMatch(/toLowerCase\(\) !== "admin"/);
  });

  test("old /admin wrapper is redirected in server.js and file is kept", () => {
    const server = fs.readFileSync(path.join(__dirname, "../../server/server.js"), "utf8");
    expect(server).toMatch(/\/admin\/index\.html/);
    expect(server).toMatch(/res\.redirect\(302, "\/admin-dashboard"\)/);
    expect(fs.existsSync(path.join(PUBLIC, "admin/index.html"))).toBe(true);
  });
});
