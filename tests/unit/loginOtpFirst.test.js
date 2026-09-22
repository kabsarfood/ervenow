process.env.ERVENOW_JWT_SECRET = process.env.ERVENOW_JWT_SECRET || "p0-test-jwt-secret-16";
process.env.ERVENOW_OTP_BACKEND = "memory";
process.env.ERVENOW_OTP_ALLOW_MEMORY = "1";
process.env.PUBLIC_ORDERING_ENABLED = "true";

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(() => global.__otpFirstSb || { from: () => ({}) }),
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
    findUserByPhone: jest.fn(async () => ({ data: null, error: null })),
  };
});

const { findUserByPhoneResilient, findUserByPhone } = require("../../shared/utils/userPhoneLookup");
const { sendOTP } = require("../../shared/services/whatsappService");
const { signRegistrationToken } = require("../../shared/utils/registrationContext");
const { resolvePostLoginPath } = require("../../shared/utils/resolvePortalRole");
const coreRouter = require("../../apps/core/routes");
const driverRouter = require("../../apps/driver/routes");
const storeRouter = require("../../apps/store/routes");

const ROOT = path.join(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");
const SERVER_JS = path.join(ROOT, "server/server.js");

function readPublic(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), "utf8");
}

function makeSb(row) {
  const result = { data: row || null, error: null };
  const q = {};
  const self = () => q;
  q.select = self;
  q.update = self;
  q.insert = self;
  q.upsert = self;
  q.eq = self;
  q.maybeSingle = async () => result;
  q.single = async () => result;
  q.then = (onF, onR) => Promise.resolve(result).then(onF, onR);
  return { from: () => q };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/core", coreRouter);
  app.use("/api/driver", driverRouter);
  app.use("/api/store", storeRouter);
  app.get("/driver-register", (req, res) => {
    const qs = new URLSearchParams();
    const q = req.query || {};
    Object.keys(q).forEach((k) => {
      const v = q[k];
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else if (v != null && v !== "") qs.set(k, String(v));
    });
    qs.set("mode", "register");
    qs.set("role", "driver");
    res.redirect(302, "/login?" + qs.toString());
  });
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

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location || "" });
      })
      .on("error", reject);
  });
}

const rows = {
  customer: {
    id: "cust-1",
    role: "customer",
    status: "active",
    phone: "966501111111",
    name: "عميل",
  },
  merchant: {
    id: "store-1",
    role: "store",
    status: "active",
    phone: "966502222222",
    name: "متجر",
  },
  driver: {
    id: "drv-1",
    role: "driver",
    status: "active",
    phone: "966503333333",
    name: "مندوب",
  },
  service: {
    id: "svc-1",
    role: "service",
    status: "active",
    phone: "966504444444",
    name: "سباك",
    service_type: "plumber",
    service_district: "العزيزية",
  },
};

async function loginExisting(port, phone, row) {
  findUserByPhoneResilient.mockResolvedValue({ data: row, error: null });
  findUserByPhone.mockResolvedValue({ data: row, error: null });
  global.__otpFirstSb = makeSb(row);
  const sent = await postJson(port, "/api/core/send-otp", { phone, login_only: true });
  expect(sent.status).toBe(200);
  expect(global.__lastOtpCode).toMatch(/^\d{5}$/);
  const verified = await postJson(port, "/api/core/verify-otp", {
    phone,
    code: global.__lastOtpCode,
    login_only: true,
  });
  return verified;
}

describe("OTP-first unified login/register", () => {
  beforeEach(() => {
    global.__lastOtpCode = null;
    global.__otpFirstSb = makeSb(null);
    sendOTP.mockClear();
    findUserByPhoneResilient.mockReset();
    findUserByPhone.mockReset();
    findUserByPhoneResilient.mockResolvedValue({ data: null, error: null });
    findUserByPhone.mockResolvedValue({ data: null, error: null });
  });

  test("1 existing customer OTP lands on /", async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const verified = await loginExisting(port, "+966501111111", rows.customer);
      expect(verified.status).toBe(200);
      expect(verified.json.token).toBeTruthy();
      expect(verified.json.user.role).toBe("customer");
      expect(verified.json.needs_registration).toBeFalsy();
      expect(resolvePostLoginPath(verified.json.user)).toBe("/");
    });
  });

  test("2 existing merchant OTP lands on /merchant-preview", async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const verified = await loginExisting(port, "+966502222222", rows.merchant);
      expect(verified.status).toBe(200);
      expect(verified.json.user.role).toBe("store");
      expect(resolvePostLoginPath(verified.json.user)).toBe("/merchant-preview");
    });
  });

  test("3 existing driver OTP lands on /driver-preview", async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const verified = await loginExisting(port, "+966503333333", rows.driver);
      expect(verified.status).toBe(200);
      expect(verified.json.user.role).toBe("driver");
      expect(resolvePostLoginPath(verified.json.user)).toBe("/driver-preview");
    });
  });

  test("4 existing service OTP lands on /service-preview", async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const verified = await loginExisting(port, "+966504444444", rows.service);
      expect(verified.status).toBe(200);
      expect(verified.json.user.role).toBe("service");
      expect(resolvePostLoginPath(verified.json.user)).toBe("/service-preview");
    });
  });

  test("checkout_customer new phone creates Customer session without membership chooser", async () => {
    const created = {
      id: "cust-checkout",
      role: "customer",
      status: "active",
      phone: "966508888888",
    };
    global.__otpFirstSb = makeSb(created);
    findUserByPhoneResilient.mockResolvedValue({ data: null, error: null });
    findUserByPhone.mockResolvedValue({ data: null, error: null });
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/core/send-otp", {
        phone: "+966508888888",
        role: "customer",
      });
      expect(sent.status).toBe(200);
      const verified = await postJson(port, "/api/core/verify-otp", {
        phone: "+966508888888",
        code: global.__lastOtpCode,
        role: "customer",
        checkout_customer: true,
      });
      expect(verified.status).toBe(200);
      expect(verified.json.needs_registration).toBeFalsy();
      expect(verified.json.token).toBeTruthy();
      expect(verified.json.user.role).toBe("customer");
    });
  });

  test("5 new phone OTP returns registration token without creating a user", async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const sent = await postJson(port, "/api/core/send-otp", {
        phone: "+966509999999",
        login_only: true,
      });
      expect(sent.status).toBe(200);
      const verified = await postJson(port, "/api/core/verify-otp", {
        phone: "+966509999999",
        code: global.__lastOtpCode,
        login_only: true,
      });
      expect(verified.status).toBe(200);
      expect(verified.json.needs_registration).toBe(true);
      expect(verified.json.registration_token).toBeTruthy();
      expect(verified.json.token).toBeFalsy();
      const payload = jwt.verify(verified.json.registration_token, process.env.ERVENOW_JWT_SECRET);
      expect(payload.purpose).toBe("ervenow_register");
      expect(payload.phone).toBe("966509999999");
    });
  });

  test("5b new customer with verified token is created and routed to /", async () => {
    const created = {
      id: "cust-new",
      role: "customer",
      status: "active",
      phone: "966509999999",
      name: "عميل جديد",
    };
    global.__otpFirstSb = makeSb(created);
    findUserByPhoneResilient.mockResolvedValue({ data: null, error: null });
    findUserByPhone.mockResolvedValue({ data: null, error: null });
    const token = signRegistrationToken("966509999999");
    const app = makeApp();
    await withServer(app, async (port) => {
      const createdRes = await postJson(port, "/api/core/register-account", {
        registration_token: token,
        role: "customer",
        name: "عميل جديد",
      });
      expect(createdRes.status).toBe(200);
      expect(createdRes.json.token).toBeTruthy();
      expect(createdRes.json.user.role).toBe("customer");
      expect(createdRes.json.pending_approval).toBeFalsy();
      expect(resolvePostLoginPath(createdRes.json.user)).toBe("/");
    });
  });

  test("6 /register-store is a verified next step, not a standalone signup portal", () => {
    const html = readPublic("register-store.html");
    expect(html).toMatch(/ervenow_registration_token/);
    expect(html).toMatch(/\/login\?mode=register&role=store/);
    expect(html).toMatch(/registration_token:\s*REG_TOKEN/);
  });

  test("7 /login driver join does not use /api/driver/send-otp or a parallel register page", () => {
    const login = readPublic("login.html");
    expect(login).toMatch(/data-join="driver"/);
    expect(login).not.toMatch(/\/api\/driver\/send-otp/);
    expect(login).not.toMatch(/\/api\/driver\/register/);
    const stub = readPublic("driver-register.html");
    expect(stub).toMatch(/\/login\?.*role=driver/);
    expect(stub).not.toMatch(/\/api\/driver\/register/);
  });

  test("8 chooser has four roles and transport is a service_type, not a role", () => {
    const login = readPublic("login.html");
    expect(login).toMatch(/كيف تريد استخدام ERVENOW؟/);
    expect(login).toMatch(/data-join="customer"/);
    expect(login).toMatch(/data-join="store"/);
    expect(login).toMatch(/data-join="driver"/);
    expect(login).toMatch(/data-join="service"/);
    expect(login).not.toMatch(/data-join="transport"/);
    expect(login).not.toMatch(/data-join="admin"/);
    expect(login).toMatch(/pickup_truck/);
  });

  test("9 /driver-register 302 to unified login register driver", async () => {
    const server = fs.readFileSync(SERVER_JS, "utf8");
    const startAt = server.indexOf('app.get(["/driver-register", "/driver-register.html"]');
    const staticAt = server.indexOf("express.static(publicPath");
    expect(startAt).toBeGreaterThan(-1);
    expect(staticAt).toBeGreaterThan(startAt);
    expect(server).toMatch(/qs\.set\("mode", "register"\)/);
    expect(server).toMatch(/qs\.set\("role", "driver"\)/);
    const app = makeApp();
    await withServer(app, async (port) => {
      const r = await request(port, "/driver-register");
      expect(r.status).toBe(302);
      expect(r.location).toBe("/login?mode=register&role=driver");
    });
  });

  test("10 store/driver/register-account without verified context are rejected", async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const account = await postJson(port, "/api/core/register-account", {
        phone: "+966509999999",
        role: "customer",
        name: "بدون توثيق",
      });
      expect(account.status).toBe(403);
      expect(account.json.code).toBe("REGISTRATION_CONTEXT_REQUIRED");

      const skipOtp = await postJson(port, "/api/core/verify-otp", {
        phone: "+966509999999",
        register_without_otp: true,
        role: "customer",
      });
      expect(skipOtp.status).toBe(403);
      expect(skipOtp.json.code).toBe("REGISTRATION_CONTEXT_REQUIRED");

      const store = await postJson(port, "/api/store/register", {
        name: "متجر تجريبي",
        phone: "0501111111",
        address: "عنوان طويل بما يكفي",
        lat: 21.5,
        lng: 39.2,
        type: "supermarket",
      });
      expect(store.status).toBe(403);
      expect(store.json.code).toBe("REGISTRATION_CONTEXT_REQUIRED");

      const driver = await postJson(port, "/api/driver/register", {
        name: "مندوب",
        phone: "0503333333",
        iqama: "1234567890",
        car_type: "sedan",
        plate_number: "ABC1234",
      });
      expect(driver.status).toBe(403);
      expect(driver.json.code).toBe("REGISTRATION_CONTEXT_REQUIRED");
    });
  });

  test("partner-portal and portal-shell point at unified /login", () => {
    const portal = readPublic("partner-portal.html");
    expect(portal).toMatch(/\/login\?mode=register&amp;role=store/);
    expect(portal).toMatch(/\/login\?mode=register&amp;role=driver/);
    expect(portal).toMatch(/\/login\?mode=register&amp;role=service/);
    expect(portal).not.toMatch(/\/driver-register/);
    expect(portal).not.toMatch(/\/register-store"/);
    const shell = readPublic("assets/portal-framework/portal-shell.js");
    expect(shell).toMatch(/driver:\s*"\/login\?role=driver"/);
    expect(shell).toMatch(/service:\s*"\/login\?role=service"/);
    expect(shell).toMatch(/admin:\s*"\/admin-login"/);
    const login = readPublic("login.html");
    expect(login).toMatch(/login_only:\s*true/);
    expect(login).not.toMatch(/\/admin-login.*data-join/);
  });

  test("login and join are separate menu entries and pages", () => {
    const index = readPublic("index.html");
    expect(index).toMatch(/href="\/login"[^>]*aria-label="الدخول"/);
    expect(index).toMatch(/href="\/join\?role=customer"/);
    expect(index).toMatch(/aria-label="إنشاء عضوية"/);
    expect(index).not.toMatch(
      /href="\/login\?mode=register&amp;role=customer"[\s\S]{0,180}إنشاء عضوية/
    );

    const login = readPublic("login.html");
    expect(login).toMatch(/function isJoinIntent/);
    expect(login).toMatch(/if \(!isJoinIntent\(\)\)/);
    expect(login).toMatch(/توثيق الجوال/);
    expect(login).toMatch(/ليس لديك عضوية\؟/);
    expect(login).toMatch(/لديك عضوية\؟/);
    expect(login).toMatch(/هذا الرقم غير مسجّل/);
    expect(login).toMatch(/هذا الرقم لديه عضوية بالفعل/);

    const server = fs.readFileSync(SERVER_JS, "utf8");
    expect(server).toMatch(/\["\/join", "\/join\.html"\]/);
  });
});
