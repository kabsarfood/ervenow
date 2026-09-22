/**
 * Admin Authentication Isolation — نقاط دخول OTP إدارية فقط.
 * تعيد استخدام otpChallengeService + WhatsApp + JWT المنصة، دون upsert أو ترقية دور.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const { sendOTP } = require("../../shared/services/whatsappService");
const { getLastWhatsAppError } = require("../../shared/utils/whatsapp");
const { twilioUserMessage } = require("../../shared/utils/twilioRuntime");
const { sendOtpLimiter } = require("../../shared/middleware/apiRateLimits");
const { buildAuthOtpMessage } = require("../../shared/messages/authWhatsApp");
const {
  OTP_SCOPE,
  otpBackendMode,
  startOtpChallenge,
  verifyOtpChallenge,
  invalidateOtpChallenge,
} = require("../../shared/services/otpChallengeService");
const { attachSiteSessionCookie } = require("../../shared/middleware/publicSiteOtpGate");
const { canonicalPhoneDigits, findUserByPhoneResilient } = require("../../shared/utils/userPhoneLookup");
const { getJwtSecret } = require("../../shared/middleware/auth");
const { canAdminOtpLogin, existingUserSessionRole } = require("../../shared/utils/roleAssignment");
const { isAllowedAdminPhoneDigits } = require("../../shared/utils/adminOtpAllowlist");
const {
  ADMIN_DASHBOARD_PATH,
  ADMIN_NOT_AUTHORIZED_AR,
} = require("../../shared/utils/adminAuthMessages");

const router = express.Router();
const OTP_TTL_MS = 5 * 60 * 1000;

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf) return xf.slice(0, 128);
  return req.ip ? String(req.ip).slice(0, 128) : null;
}

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function adminOtpKey(phoneDigits) {
  return "admin:" + String(phoneDigits || "");
}

function rejectUnauthorized(res) {
  return fail(res, ADMIN_NOT_AUTHORIZED_AR, 403, { admin_authorized: false });
}

function parseAdminPhone(raw) {
  const e164 = toE164(raw);
  if (!e164 || !isErvnowSaudiMobileE164(e164)) return null;
  const digits = canonicalPhoneDigits(toStorageDigits(e164));
  return { e164, digits };
}

async function lookupAdminCandidate(digits) {
  const sb = createServiceClient();
  if (!sb) return { sb: null, user: null };
  try {
    const found = await findUserByPhoneResilient(sb, digits);
    return { sb, user: found.data || null };
  } catch (_e) {
    return { sb, user: null };
  }
}

function isBlockedUser(user) {
  if (!user) return false;
  const st = String(user.status || "").toLowerCase();
  const role = String(user.role || "").toLowerCase();
  return st === "blocked" || role === "blocked";
}

function assertAdminEligible(user, digits) {
  return canAdminOtpLogin(user, isAllowedAdminPhoneDigits(digits));
}

function signAdminToken(userId, phoneDigits, role) {
  const secret = getJwtSecret();
  if (!secret) throw new Error("ERVENOW_JWT_SECRET مطلوب في الإنتاج");
  return jwt.sign(
    {
      sub: userId,
      phone: phoneDigits,
      role,
      auth_context: "admin",
    },
    secret,
    { expiresIn: "7d" }
  );
}

router.post("/send-otp", sendOtpLimiter, async (req, res) => {
  try {
    const parsed = parseAdminPhone(req.body?.phone);
    if (!parsed) {
      return fail(res, "رقم غير صالح — أدخل 05xxxxxxxx أو 9665xxxxxxxx", 400);
    }
    const { digits } = parsed;

    const { user } = await lookupAdminCandidate(digits);
    if (!assertAdminEligible(user, digits)) {
      return rejectUnauthorized(res);
    }
    if (isBlockedUser(user)) {
      return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
    }

    const code = genOtp();
    const key = adminOtpKey(digits);
    const mode = otpBackendMode();
    const sbOtp = mode === "supabase" ? createServiceClient() : null;
    const started = await startOtpChallenge({
      sb: sbOtp,
      mode,
      scope: OTP_SCOPE.ADMIN_LOGIN,
      subjectKey: key,
      code,
      ttlMs: OTP_TTL_MS,
      ip: clientIp(req),
    });
    if (!started.ok) {
      const st = started.cooldownSeconds ? 429 : 400;
      return fail(res, started.error || "تعذر إعداد رمز التحقق", st, {
        cooldown_seconds: started.cooldownSeconds,
      });
    }

    let sent = false;
    try {
      sent = await sendOTP(digits, code, {
        message: buildAuthOtpMessage(code, "لوحة الإدارة"),
        type: "otp_admin",
      });
    } catch (waErr) {
      console.error("[ERVENOW] admin auth send-otp whatsapp error:", waErr?.code, waErr?.message || waErr);
      sent = false;
    }
    if (!sent) {
      await invalidateOtpChallenge({
        sb: sbOtp,
        mode,
        scope: OTP_SCOPE.ADMIN_LOGIN,
        subjectKey: key,
      });
      const twilioReady = !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM)
      );
      const waErr = getLastWhatsAppError();
      const waCode = waErr && (waErr.code || waErr.status);
      let userMsg =
        "تعذر إرسال رمز واتساب — غير مضبوط على الخادم: TWILIO_ACCOUNT_SID و TWILIO_AUTH_TOKEN و TWILIO_WHATSAPP_NUMBER";
      if (twilioReady) {
        const mapped = twilioUserMessage(waErr);
        if (mapped) {
          userMsg = mapped;
        } else if (Number(waCode) === 63038) {
          userMsg =
            "تم تجاوز حد رسائل واتساب اليومي في Twilio (خطأ 63038). انتظر حتى 24 ساعة أو رقِّ الحساب من لوحة Twilio.";
        } else if (Number(waCode) === 63016 || Number(waCode) === 21608) {
          userMsg =
            "رقم الجوال غير مسجّل في Twilio Sandbox — أرسل join <كود> إلى رقم Sandbox من واتسابك أولاً.";
        } else {
          userMsg = "تعذر إرسال رمز واتساب (تحقق من Twilio ورقم المستلم في Sandbox إن وُجد)";
        }
      }
      return fail(res, userMsg, 503);
    }

    return ok(res, {
      ok: true,
      message: "تم إرسال الرمز عبر واتساب",
      sent: true,
    });
  } catch (e) {
    console.error("[ERVENOW] admin auth send-otp:", e);
    return fail(res, e.message || "خطأ في الإرسال", 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const parsed = parseAdminPhone(req.body?.phone);
    if (!parsed) return fail(res, "رقم الجوال غير صالح", 400);
    const codeIn = String(req.body?.code || "").trim();
    if (!codeIn) return fail(res, "أدخل رمز الدخول", 400);

    const { digits } = parsed;
    const { sb: sbEarly, user: existingUser } = await lookupAdminCandidate(digits);
    if (!assertAdminEligible(existingUser, digits)) {
      return rejectUnauthorized(res);
    }
    if (isBlockedUser(existingUser)) {
      return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
    }

    const key = adminOtpKey(digits);
    const mode = otpBackendMode();
    const sbOtp = mode === "supabase" ? createServiceClient() : null;
    const checked = await verifyOtpChallenge({
      sb: sbOtp,
      mode,
      scope: OTP_SCOPE.ADMIN_LOGIN,
      subjectKey: key,
      code: codeIn,
    });
    if (!checked.ok) {
      const lockCase = /قفل|محاولات كثيرة/i.test(String(checked.error || ""));
      return fail(res, checked.error || "رمز واتساب غير صحيح أو منتهي", lockCase ? 429 : 400, {
        attempts_remaining: checked.attemptsRemaining,
      });
    }

    const sb = sbEarly || createServiceClient();
    if (!sb) {
      return fail(res, `قاعدة البيانات غير جاهزة — ${getDatabaseConfigHint()}`, 503);
    }

    const refreshed = await findUserByPhoneResilient(sb, digits);
    const userRow = refreshed.data || existingUser;
    if (!assertAdminEligible(userRow, digits) || existingUserSessionRole(userRow && userRow.role) !== "admin") {
      return rejectUnauthorized(res);
    }
    if (isBlockedUser(userRow)) {
      return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
    }

    const sessionPhone = canonicalPhoneDigits(userRow.phone || digits) || digits;
    const token = signAdminToken(userRow.id, sessionPhone, "admin");
    attachSiteSessionCookie(req, res, token);

    return ok(res, {
      success: true,
      token,
      approved: true,
      auth_context: "admin",
      redirect: ADMIN_DASHBOARD_PATH,
      user: {
        id: userRow.id,
        phone: userRow.phone,
        role: "admin",
        status: userRow.status || "active",
        name: userRow.name || null,
        approved: true,
      },
    });
  } catch (e) {
    console.error("[ERVENOW] admin auth verify-otp:", e);
    const msg = e.message || String(e) || "فشل التحقق";
    if (/JWT|ERVENOW_JWT_SECRET|JWT_SECRET is not set|secret/i.test(msg)) {
      return fail(res, "مفتاح الجلسة غير مضبوط: عيّن ERVENOW_JWT_SECRET في .env", 503);
    }
    return fail(res, msg, 500);
  }
});

module.exports = router;
