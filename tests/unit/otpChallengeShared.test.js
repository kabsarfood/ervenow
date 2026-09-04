process.env.ERVENOW_JWT_SECRET = process.env.ERVENOW_JWT_SECRET || "jest-ervenow-jwt-secret-16";
process.env.ERVENOW_OTP_BACKEND = "memory";
process.env.ERVENOW_OTP_ALLOW_MEMORY = "1";
process.env.ERVENOW_OTP_RESEND_COOLDOWN_MS = "5000";
process.env.ERVENOW_OTP_LOCK_MS = "60000";
process.env.ERVENOW_OTP_MAX_ATTEMPTS = "5";

const {
  startOtpChallenge,
  verifyOtpChallenge,
  _resetMemoryStoreForTests,
} = require("../../shared/services/otpChallengeService");
const { createOtpFakeSb } = require("../helpers/otpFakeSb");

describe("otpChallengeService memory (hashed, single-use)", () => {
  beforeEach(() => {
    _resetMemoryStoreForTests();
  });

  test("valid OTP", async () => {
    const started = await startOtpChallenge({
      mode: "memory",
      scope: "core_login",
      subjectKey: "customer:966500000001",
      code: "12345",
      ttlMs: 60000,
    });
    expect(started.ok).toBe(true);
    const v = await verifyOtpChallenge({
      mode: "memory",
      scope: "core_login",
      subjectKey: "customer:966500000001",
      code: "12345",
    });
    expect(v.ok).toBe(true);
  });

  test("invalid OTP", async () => {
    await startOtpChallenge({
      mode: "memory",
      scope: "core_login",
      subjectKey: "customer:966500000002",
      code: "12345",
      ttlMs: 60000,
    });
    const v = await verifyOtpChallenge({
      mode: "memory",
      scope: "core_login",
      subjectKey: "customer:966500000002",
      code: "00000",
    });
    expect(v.ok).toBe(false);
  });

  test("expired OTP", async () => {
    await startOtpChallenge({
      mode: "memory",
      scope: "core_login",
      subjectKey: "customer:966500000003",
      code: "12345",
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const v = await verifyOtpChallenge({
      mode: "memory",
      scope: "core_login",
      subjectKey: "customer:966500000003",
      code: "12345",
    });
    expect(v.ok).toBe(false);
  });

  test("reused OTP fails", async () => {
    const key = "customer:966500000004";
    await startOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12345", ttlMs: 60000 });
    expect((await verifyOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12345" })).ok).toBe(
      true
    );
    const second = await verifyOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12345" });
    expect(second.ok).toBe(false);
    expect(String(second.error)).toMatch(/مسبق/);
  });

  test("max attempts locks", async () => {
    const key = "customer:966500000005";
    await startOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12345", ttlMs: 60000 });
    for (let i = 0; i < 5; i++) {
      await verifyOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "00000" });
    }
    const locked = await verifyOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12345" });
    expect(locked.ok).toBe(false);
    expect(String(locked.error)).toMatch(/قفل/);
  });

  test("resend cooldown", async () => {
    const key = "customer:966500000006";
    const a = await startOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12345", ttlMs: 60000 });
    expect(a.ok).toBe(true);
    const b = await startOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "12346", ttlMs: 60000 });
    expect(b.ok).toBe(false);
    expect(b.cooldownSeconds).toBeGreaterThan(0);
  });

  test("duplicate verify after success", async () => {
    const key = "customer:966500000007";
    await startOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "22222", ttlMs: 60000 });
    const first = await Promise.all([
      verifyOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "22222" }),
      verifyOtpChallenge({ mode: "memory", scope: "core_login", subjectKey: key, code: "22222" }),
    ]);
    const oks = first.filter((x) => x.ok).length;
    expect(oks).toBe(1);
  });
});

describe("otpChallengeService supabase shared storage", () => {
  test("survives new client against same store (restart simulation)", async () => {
    const store = { rows: [] };
    const sb1 = createOtpFakeSb(store);
    const started = await startOtpChallenge({
      mode: "supabase",
      sb: sb1,
      scope: "core_login",
      subjectKey: "login:966500000008",
      code: "55555",
      ttlMs: 120000,
    });
    expect(started.ok).toBe(true);
    const sb2 = createOtpFakeSb(store);
    const v = await verifyOtpChallenge({
      mode: "supabase",
      sb: sb2,
      scope: "core_login",
      subjectKey: "login:966500000008",
      code: "55555",
    });
    expect(v.ok).toBe(true);
    const reuse = await verifyOtpChallenge({
      mode: "supabase",
      sb: sb2,
      scope: "core_login",
      subjectKey: "login:966500000008",
      code: "55555",
    });
    expect(reuse.ok).toBe(false);
  });

  test("default backend is not memory in production unless allowlisted", () => {
    const prevN = process.env.NODE_ENV;
    const prevB = process.env.ERVENOW_OTP_BACKEND;
    const prevA = process.env.ERVENOW_OTP_ALLOW_MEMORY;
    process.env.NODE_ENV = "production";
    delete process.env.ERVENOW_OTP_BACKEND;
    delete process.env.ERVENOW_OTP_ALLOW_MEMORY;
    jest.resetModules();
    const mod = require("../../shared/services/otpChallengeService");
    expect(mod.otpBackendMode()).toBe("supabase");
    process.env.NODE_ENV = prevN;
    if (prevB == null) delete process.env.ERVENOW_OTP_BACKEND;
    else process.env.ERVENOW_OTP_BACKEND = prevB;
    if (prevA == null) delete process.env.ERVENOW_OTP_ALLOW_MEMORY;
    else process.env.ERVENOW_OTP_ALLOW_MEMORY = prevA;
    jest.resetModules();
  });
});
