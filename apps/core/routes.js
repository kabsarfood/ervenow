const express = require("express"); 
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const { requireAuth, getJwtSecret } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits } = require("../../shared/utils/phone");
const { createServiceClient } = require("../../shared/config/supabase");

const router = express.Router();

/* ======================
   OTP in-memory
====================== */
const otpStore = new Map();
const OTP_TTL_MS = 3 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function otpKey(phoneDigits) {
  return String(phoneDigits || "").replace(/\D/g, "");
}

function random4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** رمز ثابت للتطوير (افتراضي 12345). للإنتاج مع OTP حقيقي: USE_RANDOM_OTP=true في .env */
function getFixedLoginCode() {
  if (process.env.USE_RANDOM_OTP === "true") return "";
  return String(process.env.FIXED_LOGIN_CODE || "12345").trim();
}

function cleanupOtp() {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (v.expiresAt < now) otpStore.delete(k);
  }
}

setInterval(cleanupOtp, 60 * 1000).unref();

/* ======================
   Twilio WhatsApp
====================== */
function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function waFrom() {
  let n = String(process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
  if (!n) return null;
  if (!n.startsWith("whatsapp:")) n = "whatsapp:" + n.replace(/^\+/, "+");
  return n;
}

async function sendOtpWhatsApp(toDigits, code) {
  const client = getTwilioClient();
  const from = waFrom();
  if (!client || !from) return { sent: false, reason: "twilio_not_configured" };

  const to = "whatsapp:+" + toDigits.replace(/^\+/, "");
  const body = `رمز تحقق ERVENOW: ${code}\nصالح لمدة 3 دقائق. لا تشارك الرمز مع أحد.`;

  await client.messages.create({ from, to, body });
  return { sent: true };
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
  const mode = getFixedLoginCode() ? "fixed_login_code+jwt" : "twilio_otp+jwt";
  ok(res, { service: "core", version: "2.1.0", auth: mode });
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

router.post("/send-otp", async (req, res) => {
  try {
    cleanupOtp();
    const raw = req.body?.phone;
    const e164 = toE164(raw);
    if (!e164) return fail(res, "رقم الجوال غير صالح");

    const digits = toStorageDigits(e164);
    if (digits.length < 10) return fail(res, "رقم الجوال غير صالح");

    const fixed = getFixedLoginCode();
    const code = fixed || random4();
    const expiresAt = Date.now() + OTP_TTL_MS;
    otpStore.set(digits, { code, expiresAt, attempts: 0 });

    const allowDev = process.env.ALLOW_DEV_OTP === "true";
    let twilioResult = { sent: false, reason: "skipped_fixed_otp" };

    if (!fixed) {
      twilioResult = await sendOtpWhatsApp(digits, code);
      if (!twilioResult.sent) {
        if (twilioResult.reason === "twilio_not_configured") {
          console.warn(
            "[ERVENOW] Twilio غير مضبوط — يُعاد الرمز في الاستجابة (devOtp). للإنتاج اضبط TWILIO_* في .env"
          );
        } else {
          return fail(res, "تعذر إرسال الرمز عبر واتساب", 503);
        }
      }
    }

    const payload = {
      message: fixed
        ? "رمز الدخول ثابت للتطوير — أدخل الرمز في الحقل"
        : twilioResult.sent
          ? "تم إرسال الكود"
          : "تم تجهيز الرمز (واتساب غير مضبوط — استخدم رمز التجربة المعروض)",
    };
    if (fixed || !twilioResult.sent || allowDev) {
      payload.devOtp = code;
    }

    ok(res, payload);
  } catch (e) {
    console.error("[ERVENOW] send-otp:", e);
    fail(res, e.message || "خطأ في الإرسال", 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    cleanupOtp();
    const raw = req.body?.phone;
    const codeIn = String(req.body?.code || "").trim();

    const e164 = toE164(raw);
    if (!e164 || !codeIn) return fail(res, "الرقم والرمز مطلوبان");

    const digits = toStorageDigits(e164);
    const fixed = getFixedLoginCode();

    if (fixed && codeIn === fixed) {
      otpStore.delete(digits);
    } else {
      const entry = otpStore.get(digits);

      if (!entry) return fail(res, "لا يوجد رمز نشط لهذا الرقم. اطلب رمزًا جديدًا", 400);
      if (Date.now() > entry.expiresAt) {
        otpStore.delete(digits);
        return fail(res, "انتهت صلاحية الرمز", 400);
      }

      entry.attempts += 1;
      if (entry.attempts > OTP_MAX_ATTEMPTS) {
        otpStore.delete(digits);
        return fail(res, "تجاوزت عدد المحاولات", 429);
      }

      if (entry.code !== codeIn) {
        return fail(res, "رمز غير صحيح", 400);
      }

      otpStore.delete(digits);
    }

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
      if (e164) phone = toStorageDigits(e164);
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
