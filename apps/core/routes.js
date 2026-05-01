const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth, getJwtSecret } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");

const router = express.Router();
const adminOtpStore = new Map();
const ADMIN_OTP_TTL_MS = 5 * 60 * 1000;

router.use((req, res, next) => {
  console.log("📥 CORE ROUTE HIT:", req.method, req.url);
  next();
});

/** رمز دخول موحّد (بدون واتساب / بدون عشوائي). قابل للتغيير عبر ERVENOW_LOGIN_CODE */
const ERVENOW_LOGIN_CODE = String(
  process.env.ERVENOW_LOGIN_CODE || process.env.FIXED_LOGIN_CODE || "12345"
).trim();
const ADMIN_LOGIN_PHONE_RAW = String(
  process.env.ERVENOW_ADMIN_LOGIN_PHONE || "0505745650"
).trim();

function toStoragePhoneDigits(input) {
  const e = toE164(input);
  return e ? toStorageDigits(e) : String(input || "").replace(/\D/g, "");
}

const ERVENOW_ADMIN_LOGIN_PHONE = toStoragePhoneDigits(ADMIN_LOGIN_PHONE_RAW);

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function isAllowedAdminPhoneDigits(phoneDigits) {
  return String(phoneDigits || "").replace(/\D/g, "") === ERVENOW_ADMIN_LOGIN_PHONE;
}

/* ======================
   JWT (جلسة المنصة)
====================== */
function signPlatformToken(userId, phoneDigits, role) {
  const secret = getJwtSecret();
  if (!secret) throw new Error("ERVENOW_JWT_SECRET مطلوب في الإنتاج");
  return jwt.sign(
    { sub: userId, phone: phoneDigits, role },
    secret,
    { expiresIn: "7d" }
  );
}

/* ======================
   upsert مستخدم (بدون Supabase Auth)
====================== */
const ALLOWED_USER_ROLES = new Set(["customer", "driver", "restaurant", "merchant", "service", "admin"]);
const ALLOWED_SERVICE_TYPES = new Set([
  "plumber",
  "electrician",
  "nursery",
  "ac_technician",
  "cleaning",
  "vehicle_transfer",
  "internal_delivery",
  "pickup_truck",
  "furniture_move",
  "gas_delivery",
]);

function normalizeServiceType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  return ALLOWED_SERVICE_TYPES.has(s) ? s : null;
}

function isMissingStatusColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.status|column .*status.* does not exist|Could not find the .*status/i.test(msg);
}

async function upsertDriverByPhone(sb, phoneDigits, preferredRole, preferredServiceType) {
  const role = ALLOWED_USER_ROLES.has(preferredRole) ? preferredRole : "customer";
  const serviceType = role === "service" ? normalizeServiceType(preferredServiceType) : null;

  let existing = null;
  let selErr = null;
  const firstSel = await sb
    .from("users")
    .select("id, role, status, phone, service_type, updated_at")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (firstSel.error && isMissingStatusColumnError(firstSel.error)) {
    const fallbackSel = await sb
      .from("users")
      .select("id, role, phone, service_type, updated_at")
      .eq("phone", phoneDigits)
      .maybeSingle();
    existing = fallbackSel.data || null;
    selErr = fallbackSel.error || null;
  } else {
    existing = firstSel.data || null;
    selErr = firstSel.error || null;
  }

  if (selErr) return { data: null, error: selErr };

  const now = new Date().toISOString();

  if (existing?.id) {
    if (
      String(existing.status || "").toLowerCase() === "blocked" ||
      String(existing.role || "").toLowerCase() === "blocked"
    ) {
      return { data: existing, error: null };
    }
    return sb
      .from("users")
      .update({ role, service_type: serviceType, updated_at: now })
      .eq("id", existing.id)
      .select()
      .single();
  }

  const withStatusInsert = await sb
    .from("users")
    .insert({ phone: phoneDigits, role, status: "active", service_type: serviceType, updated_at: now })
    .select()
    .single();
  if (!withStatusInsert.error) return withStatusInsert;
  if (!isMissingStatusColumnError(withStatusInsert.error)) return withStatusInsert;
  return sb
    .from("users")
    .insert({ phone: phoneDigits, role, service_type: serviceType, updated_at: now })
    .select()
    .single();
}

router.get("/", (_req, res) => {
  ok(res, { service: "core", endpoints: ["/health", "/public-config", "/verify-otp", "/me"] });
});

router.get("/health", (_req, res) => {
  ok(res, { service: "core", version: "2.1.0", auth: "ervenow_unified+05+jwt" });
});

router.get("/public-config", (_req, res) => {
  try {
    const { getUrl, getAnonKey } = require("../../shared/config/supabase");
    ok(res, {
      supabaseUrl: getUrl(),
      supabaseAnonKey: getAnonKey(),
    });
  } catch (e) {
    fail(res, e.message || "config error", 500);
  }
});

/**
 * اختياري — للواجهات التي ما زالت تستدعي send-otp؛ لا واتساب ولا تخزين رمز.
 */
router.post("/send-otp", async (req, res) => {
  try {
    const raw = req.body?.phone;
    const roleIn = String(req.body?.role || "").trim().toLowerCase();
    const e164 = toE164(raw);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) {
      return fail(
        res,
        "رقم غير صالح — أدخل رقم سعودي يبدأ بـ 05 (مثال 05xxxxxxxx)",
        400
      );
    }

    const digits = toStorageDigits(e164);
    if (roleIn === "admin") {
      if (!isAllowedAdminPhoneDigits(digits)) {
        return fail(res, "غير مصرح لهذا الرقم بدخول لوحة الإدارة", 403);
      }
      const code = genOtp();
      adminOtpStore.set(digits, { code, expiresAt: Date.now() + ADMIN_OTP_TTL_MS });
      let sent = false;
      try {
        sent = await sendWhatsApp({
          to: digits,
          message: `رمز دخول لوحة إدارة ERVENOW: ${code}`,
        });
      } catch (waErr) {
        console.error("[ERVENOW] admin send-otp whatsapp error:", waErr?.message || waErr);
        sent = false;
      }
      if (!sent) return fail(res, "تعذر إرسال رمز واتساب للأدمن", 503);
      return ok(res, { ok: true, message: "تم إرسال الرمز عبر واتساب" });
    }

    ok(res, {
      message: "دخول ERVENOW: أدخل رمز 12345",
      devOtp: ERVENOW_LOGIN_CODE,
    });
  } catch (e) {
    console.error("[ERVENOW] send-otp:", e);
    fail(res, e.message || "خطأ في الإرسال", 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const raw = req.body?.phone;
    const codeIn = String(req.body?.code || "").trim();
    const wantRole = String(req.body?.role || "customer").trim();

    const e164 = toE164(raw);
    if (!e164) return fail(res, "رقم الجوال غير صالح", 400);
    if (!isErvnowSaudiMobileE164(e164)) {
      return fail(
        res,
        "رقم غير صالح — يجب أن يبدأ بـ 05 (مثال 05xxxxxxxx)",
        400
      );
    }
    if (!codeIn) return fail(res, "أدخل رمز الدخول", 400);

    const digits = toStorageDigits(e164);
    if (wantRole === "admin") {
      if (!isAllowedAdminPhoneDigits(digits)) {
        return fail(res, "غير مصرح لهذا الرقم بدخول لوحة الإدارة", 403);
      }
      const saved = adminOtpStore.get(digits);
      const valid =
        !!saved &&
        String(saved.code || "") === codeIn &&
        Number(saved.expiresAt || 0) > Date.now();
      if (!valid) return fail(res, "رمز واتساب غير صحيح أو منتهي", 400);
      adminOtpStore.delete(digits);
    } else if (codeIn !== ERVENOW_LOGIN_CODE) {
      return fail(res, "رمز الدخول غير صحيح", 400);
    }

    const sb = createServiceClient();
    if (!sb) {
      return fail(
        res,
        `قاعدة البيانات غير جاهزة — ${getDatabaseConfigHint()}`,
        503
      );
    }

    const wantServiceType = req.body?.service_type;
    const { data: userRow, error: dbErr } = await upsertDriverByPhone(sb, digits, wantRole, wantServiceType);
    if (dbErr) {
      console.error("[ERVENOW] verify-otp DB:", dbErr);
      return fail(
        res,
        dbErr.message ||
          "فشل حفظ المستخدم. نفّذ migration_users_phone_auth.sql في Supabase",
        400
      );
    }

    if (!userRow || userRow.id == null) {
      console.error("[ERVENOW] verify-otp: userRow missing after upsert");
      return fail(res, "فشل إنشاء المستخدم في قاعدة البيانات", 500);
    }

    const token = signPlatformToken(userRow.id, digits, userRow.role || wantRole);

    ok(res, {
      success: true,
      token,
      user: {
        id: userRow.id,
        phone: userRow.phone,
        role: userRow.role,
        service_type: userRow.service_type || null,
      },
    });
  } catch (e) {
    console.error("[ERVENOW] verify-otp:", e);
    const msg = e.message || String(e) || "فشل التحقق";
    if (/JWT|ERVENOW_JWT_SECRET|JWT_SECRET is not set|secret/i.test(msg)) {
      return fail(res, "مفتاح الجلسة غير مضبوط: عيّن ERVENOW_JWT_SECRET في .env", 503);
    }
    fail(res, msg, 500);
  }
});

router.get("/me", requireAuth, (req, res) => {
  ok(res, {
    user: {
      id: req.authUser.id,
      phone: req.authUser.phone,
    },
    profile: req.appUser,
  });
});

router.post("/users/sync", requireAuth, async (req, res) => {
  try {
    const roleIn = String(req.body?.role || "").trim();
    const allowed = ["driver", "customer", "admin", "restaurant", "merchant", "service"];
    const role = allowed.includes(roleIn) ? roleIn : req.appUser.role;
    const serviceType = role === "service" ? normalizeServiceType(req.body?.service_type) : null;

    let phone = req.body?.phone || req.appUser.phone;
    if (phone) {
      const e164 = toE164(phone);
      if (e164) {
        if (!isErvnowSaudiMobileE164(e164)) {
          return fail(res, "رقم الجوال يجب أن يبدأ بـ 05", 400);
        }
        phone = toStorageDigits(e164);
      }
    }

    const row = {
      id: req.appUser.id,
      phone,
      role,
      service_type: serviceType,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await req.supabase.from("users").upsert(row, { onConflict: "id" }).select().single();

    if (error) return fail(res, error.message, 400);
    ok(res, { profile: data });
  } catch (e) {
    fail(res, e.message || "sync failed", 500);
  }
});

router.get("/roles/check", requireAuth, requireRole("admin"), (_req, res) => {
  ok(res, { message: "admin OK" });
});

module.exports = router;
