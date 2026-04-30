const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");

const router = express.Router();
const MIN_WITHDRAW = 20;
const withdrawOtpStore = new Map();
const WITHDRAW_OTP_TTL_MS = 5 * 60 * 1000;
const WITHDRAW_OTP_LOCK_MS = 5 * 60 * 1000;
const WITHDRAW_OTP_MAX_ATTEMPTS = 3;

/** آيبان سعودي: SA + 22 رقماً (24 حرفاً إجمالاً) */
function isValidIBAN(iban) {
  return /^SA\d{22}$/i.test(iban);
}

/** مندوب، متجر، مقدم خدمة — محفظة سحب ERVENOW (ervenow_wallets) */
const PAYOUT_ROLES = ["driver", "restaurant", "merchant", "service"];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function nowMs() {
  return Date.now();
}

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function allowDevOtp() {
  return String(process.env.ALLOW_DEV_OTP || "")
    .trim()
    .toLowerCase() === "true";
}

function getRemainingLockSeconds(state) {
  if (!state || !state.lockUntil) return 0;
  const remain = Math.ceil((Number(state.lockUntil) - nowMs()) / 1000);
  return remain > 0 ? remain : 0;
}

async function validateWithdrawRequest(req, amount) {
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
    throw new Error(`الحد الأدنى للسحب ${MIN_WITHDRAW} ريال`);
  }

  const { data: u, error: uErr } = await req.supabase.from("users").select("iban").eq("id", req.appUser.id).single();
  if (uErr) throw new Error(uErr.message);
  const ibanRaw = u && u.iban != null ? String(u.iban).trim().replace(/\s+/g, "") : "";
  if (!ibanRaw) throw new Error("لا يوجد حساب بنكي (IBAN) مسجّل");
  if (!isValidIBAN(ibanRaw)) {
    throw new Error("IBAN غير صالح — يُقبل آيبان سعودي SA متبوعاً بـ 22 رقماً");
  }

  const { data: w } = await req.supabase.from("ervenow_wallets").select("balance").eq("user_id", req.appUser.id).maybeSingle();
  const bal = Number(w?.balance) || 0;
  if (amount > bal) throw new Error("الرصيد غير كافٍ");

  return { ibanRaw, bal };
}

router.get("/", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("ervenow_wallets")
      .select("*")
      .eq("user_id", req.appUser.id)
      .maybeSingle();
    if (error) return fail(res, error.message, 400);
    const w = data || { balance: 0, total_earned: 0, total_withdrawn: 0, role: req.appUser.role };
    ok(res, {
      balance: round2(w.balance) || 0,
      total_earned: round2(w.total_earned) || 0,
      total_withdrawn: round2(w.total_withdrawn) || 0,
    });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/transactions", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("ervenow_wallet_transactions")
      .select("id, amount, type, reference_id, note, created_at")
      .eq("user_id", req.appUser.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return fail(res, error.message, 400);
    ok(res, { transactions: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/withdraw", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
      return fail(res, `الحد الأدنى للسحب ${MIN_WITHDRAW} ريال`, 400);
    }

    const { data: u, error: uErr } = await req.supabase.from("users").select("iban").eq("id", req.appUser.id).single();
    if (uErr) return fail(res, uErr.message, 400);
    const ibanRaw = u && u.iban != null ? String(u.iban).trim().replace(/\s+/g, "") : "";
    if (!ibanRaw) {
      return fail(res, "لا يوجد حساب بنكي (IBAN) مسجّل", 400);
    }
    if (!isValidIBAN(ibanRaw)) {
      return fail(res, "IBAN غير صالح — يُقبل آيبان سعودي SA متبوعاً بـ 22 رقماً", 400);
    }

    const { data: w } = await req.supabase.from("ervenow_wallets").select("balance").eq("user_id", req.appUser.id).maybeSingle();
    const bal = Number(w?.balance) || 0;
    if (amount > bal) {
      return fail(res, "الرصيد غير كافٍ", 400);
    }

    const { error: insE } = await req.supabase.from("ervenow_withdraw_requests").insert({
      user_id: req.appUser.id,
      amount,
      iban: ibanRaw,
      status: "pending",
    });
    if (insE) return fail(res, insE.message, 400);
    ok(res, { message: "تم إرسال طلب السحب" });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/withdraw/send-otp", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const { ibanRaw } = await validateWithdrawRequest(req, amount);

    const current = withdrawOtpStore.get(req.appUser.id);
    const lockSeconds = getRemainingLockSeconds(current);
    if (lockSeconds > 0) {
      return fail(res, `تم قفل المحاولة مؤقتًا لمدة ${lockSeconds} ثانية`, 429, {
        lock_seconds: lockSeconds,
        attempts_remaining: 0,
      });
    }

    const phone = String(req.appUser?.phone || "").trim();
    if (!phone) return fail(res, "رقم جوال المندوب غير متوفر", 400);

    const code = genOtp();
    withdrawOtpStore.set(req.appUser.id, {
      code,
      amount,
      iban: ibanRaw,
      expiresAt: nowMs() + WITHDRAW_OTP_TTL_MS,
      failedAttempts: 0,
      lockUntil: 0,
    });

    let sent = false;
    try {
      sent = await sendWhatsApp({
        to: phone,
        message: `رمز سحب المحفظة ERVENOW: ${code}`,
      });
    } catch (e) {
      sent = false;
    }

    const payload = {
      ok: true,
      sent,
      message: sent ? "تم إرسال رمز التحقق" : "تعذر إرسال الرسالة تلقائيًا",
    };
    if (allowDevOtp()) payload.dev_otp = code;
    return res.json(payload);
  } catch (e) {
    return fail(res, e.message, 400);
  }
});

router.post("/withdraw/confirm-otp", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) return fail(res, "رمز التحقق مطلوب", 400);

    const pending = withdrawOtpStore.get(req.appUser.id);
    const lockSeconds = getRemainingLockSeconds(pending);
    if (lockSeconds > 0) {
      return fail(res, `تم قفل زر التأكيد مؤقتًا لمدة ${lockSeconds} ثانية`, 429, {
        lock_seconds: lockSeconds,
        attempts_remaining: 0,
      });
    }
    if (!pending || pending.expiresAt <= nowMs()) {
      withdrawOtpStore.delete(req.appUser.id);
      return fail(res, "انتهت صلاحية رمز السحب", 400);
    }
    if (pending.code !== code) {
      pending.failedAttempts = Number(pending.failedAttempts || 0) + 1;
      if (pending.failedAttempts >= WITHDRAW_OTP_MAX_ATTEMPTS) {
        pending.lockUntil = nowMs() + WITHDRAW_OTP_LOCK_MS;
        const remain = getRemainingLockSeconds(pending);
        withdrawOtpStore.set(req.appUser.id, pending);
        return fail(res, `تم قفل زر التأكيد ${remain} ثانية بسبب 3 محاولات خاطئة`, 429, {
          lock_seconds: remain,
          attempts_remaining: 0,
        });
      }
      withdrawOtpStore.set(req.appUser.id, pending);
      return fail(res, "رمز التحقق غير صحيح", 400, {
        attempts_remaining: Math.max(0, WITHDRAW_OTP_MAX_ATTEMPTS - pending.failedAttempts),
      });
    }

    const amount = Number(pending.amount);
    const { ibanRaw } = await validateWithdrawRequest(req, amount);

    const { error: insE } = await req.supabase.from("ervenow_withdraw_requests").insert({
      user_id: req.appUser.id,
      amount,
      iban: ibanRaw || pending.iban,
      status: "pending",
      note: "OTP verified",
    });
    if (insE) return fail(res, insE.message, 400);

    withdrawOtpStore.delete(req.appUser.id);
    return ok(res, { message: "تم إرسال طلب السحب بنجاح بعد التحقق" });
  } catch (e) {
    return fail(res, e.message, 400);
  }
});

module.exports = router;
