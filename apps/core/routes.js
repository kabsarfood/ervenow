const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth, getJwtSecret } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");

const router = express.Router();
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;

const ADMIN_LOGIN_PHONE_RAW = String(
  process.env.ERVENOW_ADMIN_LOGIN_PHONE || "0505745650"
).trim();

function toStoragePhoneDigits(input) {
  const e = toE164(input);
  return e ? toStorageDigits(e) : String(input || "").replace(/\D/g, "");
}

const ERVENOW_ADMIN_LOGIN_PHONE = toStoragePhoneDigits(ADMIN_LOGIN_PHONE_RAW);

/** أرقام مسموح لها OTP لوحة الإدارة — LOGIN + قوائم الأدمن (نفس منطق apps/admin) */
function adminOtpDigitsFromEnvList(rawList) {
  const out = [];
  for (const part of String(rawList || "").split(",")) {
    const raw = String(part || "").trim();
    if (!raw) continue;
    const e = toE164(raw);
    if (!e || !isErvnowSaudiMobileE164(e)) continue;
    out.push(toStorageDigits(e));
  }
  return out;
}

const ADMIN_OTP_ALLOWED_DIGITS = new Set([
  ERVENOW_ADMIN_LOGIN_PHONE,
  ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_FULL_PHONES),
  ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_LIMITED1_PHONES),
  ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_LIMITED2_PHONES),
]);

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function otpKey(role, phoneDigits) {
  return String(role || "customer").toLowerCase() + ":" + String(phoneDigits || "");
}

function isAllowedAdminPhoneDigits(phoneDigits) {
  const d = String(phoneDigits || "").replace(/\D/g, "");
  return ADMIN_OTP_ALLOWED_DIGITS.has(d);
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

function isMissingNameColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.name|column .*name.* does not exist|Could not find the .*name/i.test(msg);
}

async function upsertDriverByPhone(sb, phoneDigits, preferredRole, preferredServiceType, displayName) {
  const role = ALLOWED_USER_ROLES.has(preferredRole) ? preferredRole : "customer";
  const serviceType = role === "service" ? normalizeServiceType(preferredServiceType) : null;
  const trimmedName =
    role === "customer" && displayName ? String(displayName).trim().slice(0, 200) : "";

  let existing = null;
  let selErr = null;
  let firstSel = await sb
    .from("users")
    .select("id, role, status, phone, service_type, updated_at, name")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (firstSel.error && isMissingNameColumnError(firstSel.error)) {
    firstSel = await sb
      .from("users")
      .select("id, role, status, phone, service_type, updated_at")
      .eq("phone", phoneDigits)
      .maybeSingle();
  }
  if (firstSel.error && isMissingStatusColumnError(firstSel.error)) {
    let fallbackSel = await sb
      .from("users")
      .select("id, role, phone, service_type, updated_at, name")
      .eq("phone", phoneDigits)
      .maybeSingle();
    if (fallbackSel.error && isMissingNameColumnError(fallbackSel.error)) {
      fallbackSel = await sb
        .from("users")
        .select("id, role, phone, service_type, updated_at")
        .eq("phone", phoneDigits)
        .maybeSingle();
    }
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
    const patch = { role, service_type: serviceType, updated_at: now };
    if (trimmedName && role === "customer" && !String(existing.name || "").trim()) {
      patch.name = trimmedName;
    }
    let upd = await sb.from("users").update(patch).eq("id", existing.id).select().single();
    if (upd.error && isMissingNameColumnError(upd.error) && patch.name != null) {
      delete patch.name;
      upd = await sb.from("users").update(patch).eq("id", existing.id).select().single();
    }
    return upd;
  }

  const insertRow = {
    phone: phoneDigits,
    role,
    service_type: serviceType,
    updated_at: now,
    ...(trimmedName && role === "customer" ? { name: trimmedName } : {}),
  };
  const withStatusInsert = await sb
    .from("users")
    .insert({ ...insertRow, status: "active" })
    .select()
    .single();
  if (!withStatusInsert.error) return withStatusInsert;
  if (
    isMissingNameColumnError(withStatusInsert.error) &&
    trimmedName &&
    role === "customer"
  ) {
    const { name: _drop, ...insertNoName } = insertRow;
    const retry = await sb
      .from("users")
      .insert({ ...insertNoName, status: "active" })
      .select()
      .single();
    if (!retry.error) return retry;
    if (!isMissingStatusColumnError(retry.error)) return retry;
    return sb.from("users").insert(insertNoName).select().single();
  }
  if (!isMissingStatusColumnError(withStatusInsert.error)) return withStatusInsert;
  const noStatus = await sb.from("users").insert(insertRow).select().single();
  if (!noStatus.error) return noStatus;
  if (
    isMissingNameColumnError(noStatus.error) &&
    trimmedName &&
    role === "customer"
  ) {
    const { name: _d, ...insertNoName } = insertRow;
    return sb.from("users").insert(insertNoName).select().single();
  }
  return noStatus;
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
    const role = roleIn || "customer";
    if (roleIn === "admin") {
      if (!isAllowedAdminPhoneDigits(digits)) {
        return fail(res, "غير مصرح لهذا الرقم بدخول لوحة الإدارة", 403);
      }
    }
    const code = genOtp();
    const key = otpKey(role, digits);
    otpStore.set(key, { code, expiresAt: Date.now() + OTP_TTL_MS });
    let sent = false;
    try {
      sent = await sendWhatsApp({
        to: digits,
        message: role === "admin"
          ? `رمز دخول لوحة إدارة ERVENOW: ${code}`
          : `رمز دخول ERVENOW: ${code}`,
      });
    } catch (waErr) {
      console.error("[ERVENOW] send-otp whatsapp error:", waErr?.message || waErr);
      sent = false;
    }
    if (!sent) {
      const twilioReady = !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM)
      );
      return fail(
        res,
        twilioReady
          ? "تعذر إرسال رمز واتساب (تحقق من Twilio ورقم المستلم في Sandbox إن وُجد)"
          : "تعذر إرسال رمز واتساب — غير مضبوط على الخادم: TWILIO_ACCOUNT_SID و TWILIO_AUTH_TOKEN و TWILIO_WHATSAPP_NUMBER",
        503
      );
    }
    const payload = {
      ok: true,
      message: "تم إرسال الرمز عبر واتساب",
      sent: true,
    };
    ok(res, payload);
  } catch (e) {
    console.error("[ERVENOW] send-otp:", e);
    fail(res, e.message || "خطأ في الإرسال", 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const raw = req.body?.phone;
    const codeIn = String(req.body?.code || "").trim();
    const wantRole = String(req.body?.role || "customer").trim().toLowerCase();

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
    }

    const key = otpKey(wantRole, digits);
    const saved = otpStore.get(key);
    const valid =
      !!saved &&
      String(saved.code || "") === codeIn &&
      Number(saved.expiresAt || 0) > Date.now();
    if (!valid) return fail(res, "رمز واتساب غير صحيح أو منتهي", 400);
    if (valid) otpStore.delete(key);

    const sb = createServiceClient();
    if (!sb) {
      return fail(
        res,
        `قاعدة البيانات غير جاهزة — ${getDatabaseConfigHint()}`,
        503
      );
    }

    const wantServiceType = req.body?.service_type;
    const displayName = wantRole === "customer" ? String(req.body?.name || "").trim() : "";
    const { data: userRow, error: dbErr } = await upsertDriverByPhone(
      sb,
      digits,
      wantRole,
      wantServiceType,
      displayName
    );
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
        name: userRow.name || null,
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
      name: req.appUser.name || null,
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
