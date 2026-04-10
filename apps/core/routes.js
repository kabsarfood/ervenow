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
  const body = `رمز تحقق ERWENOW: ${code}\nصالح لمدة 3 دقائق. لا تشارك الرمز مع أحد.`;

  await client.messages.create({ from, to, body });
  return { sent: true };
}

/* ======================
   JWT (جلسة المنصة)
====================== */
function signPlatformToken(userId, phoneDigits, role) {
  const secret = getJwtSecret();
  if (!secret) throw new Error("ERWENOW_JWT_SECRET missing");
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
  ok(res, { service: "core", version: "2.1.0", auth: "twilio_otp+jwt" });
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

    const code = random4();
    const expiresAt = Date.now() + OTP_TTL_MS;
    otpStore.set(digits, { code, expiresAt, attempts: 0 });

    const twilioResult = await sendOtpWhatsApp(digits, code);
    const allowDev = process.env.ALLOW_DEV_OTP === "true";
    const twilioReady = getTwilioClient() && waFrom();

    if (!twilioResult.sent) {
      console.warn("[ERWENOW] Twilio غير مضبوط — OTP للتطوير:", digits, code);
      if (!allowDev) {
        return fail(
          res,
          "تعذر إرسال واتساب. اضبط TWILIO_* في .env أو فعّل ALLOW_DEV_OTP=true للتجربة",
          503
        );
      }
    }

    const payload = { message: "تم إرسال الكود" };
    if (allowDev) payload.devOtp = code;

    ok(res, payload);
  } catch (e) {
    console.error("[ERWENOW] send-otp:", e);
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

    const sb = createServiceClient();
    if (!sb) {
      return fail(
        res,
        "SUPABASE_SERVICE_ROLE_KEY مطلوب لحفظ المستخدم بعد التحقق",
        503
      );
    }

    const wantRole = String(req.body?.role || "customer").trim();
    const { data: userRow, error: dbErr } = await upsertDriverByPhone(sb, digits, wantRole);
    if (dbErr) {
      console.error("[ERWENOW] verify-otp DB:", dbErr);
      return fail(
        res,
        dbErr.message ||
          "فشل حفظ المستخدم. نفّذ migration_users_phone_auth.sql في Supabase",
        400
      );
    }

    const token = signPlatformToken(userRow.id, digits, userRow.role || wantRole);

    ok(res, {
      success: true,
      token,
      user: { id: userRow.id, phone: userRow.phone, role: userRow.role },
    });
  } catch (e) {
    console.error("[ERWENOW] verify-otp:", e);
    fail(res, e.message || "فشل التحقق", 500);
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
