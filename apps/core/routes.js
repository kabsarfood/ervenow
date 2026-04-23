const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth, getJwtSecret } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { createServiceClient } = require("../../shared/config/supabase");

const router = express.Router();

/** رمز دخول موحّد (بدون واتساب / بدون عشوائي). قابل للتغيير عبر ERVENOW_LOGIN_CODE */
const ERVENOW_LOGIN_CODE = String(
  process.env.ERVENOW_LOGIN_CODE || process.env.FIXED_LOGIN_CODE || "12345"
).trim();

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

async function upsertDriverByPhone(sb, phoneDigits, preferredRole) {
  const role = ALLOWED_USER_ROLES.has(preferredRole) ? preferredRole : "customer";

  const { data: existing, error: selErr } = await sb
    .from("users")
    .select("id")
    .eq("phone", phoneDigits)
    .maybeSingle();

  if (selErr) return { data: null, error: selErr };

  const now = new Date().toISOString();

  if (existing?.id) {
    return sb
      .from("users")
      .update({ role, updated_at: now })
      .eq("id", existing.id)
      .select()
      .single();
  }

  return sb
    .from("users")
    .insert({ phone: phoneDigits, role, updated_at: now })
    .select()
    .single();
}

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
    const e164 = toE164(raw);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) {
      return fail(
        res,
        "رقم غير صالح — أدخل رقم سعودي يبدأ بـ 05 (مثال 05xxxxxxxx)",
        400
      );
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
    if (codeIn !== ERVENOW_LOGIN_CODE) {
      return fail(res, "رمز الدخول غير صحيح", 400);
    }

    const digits = toStorageDigits(e164);

    const sb = createServiceClient();
    if (!sb) {
      return fail(
        res,
        "قاعدة البيانات غير جاهزة: اضبط SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في ملف .env ثم أعد تشغيل الخادم",
        503
      );
    }

    const wantRole = String(req.body?.role || "customer").trim();
    const { data: userRow, error: dbErr } = await upsertDriverByPhone(sb, digits, wantRole);
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
      user: { id: userRow.id, phone: userRow.phone, role: userRow.role },
    });
  } catch (e) {
    console.error("[ERVENOW] verify-otp:", e);
    const msg = e.message || String(e) || "فشل التحقق";
    if (/JWT|ERVENOW_JWT_SECRET|secret/i.test(msg)) {
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
    const allowed = ["driver", "customer", "admin", "restaurant"];
    const role = allowed.includes(roleIn) ? roleIn : req.appUser.role;

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
