/**
 * /api/wallet — FINANCE_MODE=ledger_only: ervenow_ledger_wallets / ervenow_ledger_transactions
 */
const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { buildAuthOtpMessage } = require("../../shared/messages/authWhatsApp");
const { stripIban, ibanFingerprintFromPlain } = require("../../shared/utils/payoutUniqueness");
const {
  OTP_SCOPE,
  otpBackendMode,
  startOtpChallenge,
  verifyOtpChallenge,
  invalidateOtpChallenge,
} = require("../../shared/services/otpChallengeService");
const { insertAuditEvent } = require("../../shared/services/auditLog");
const {
  getWalletPayloadWithLedgerFallback,
  getWalletMePayload,
  listLedgerWalletTransactions,
  listLedgerWithdrawRequests,
  getWithdrawAvailableBalance,
} = require("../../shared/utils/ledgerWallet");
const { createServiceClient } = require("../../shared/config/supabase");
const { assertWithdrawSystemEnabled } = require("../../shared/utils/platformFeatureFlags");
const { loadPlatformPaySettings, assertWithdrawEnabledPay } = require("../../shared/services/platformPaySettings");
const {
  createTopupRequest,
  redeemTopupCode,
} = require("../../shared/services/walletTopupService");
const { createNotification } = require("../../shared/services/notificationService");

const router = express.Router();
const MIN_WITHDRAW = 20;
const WITHDRAW_OTP_TTL_MS = 5 * 60 * 1000;

const WALLET_READ_ROLES = ["driver", "store", "restaurant", "merchant", "service", "customer", "admin"];
const PAYOUT_ROLES = ["driver", "store", "restaurant", "merchant", "service"];

function walletRecipientTypeByRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "driver") return "driver";
  if (r === "store" || r === "merchant" || r === "restaurant") return "store";
  if (r === "service") return "provider";
  if (r === "admin") return "admin";
  return "customer";
}

function isValidIBAN(iban) {
  return /^SA\d{22}$/i.test(iban);
}

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function allowDevOtp() {
  return String(process.env.ALLOW_DEV_OTP || "")
    .trim()
    .toLowerCase() === "true";
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf) return xf.slice(0, 128);
  return req.ip ? String(req.ip).slice(0, 128) : null;
}

async function operationalWalletPayload(req) {
  return getWalletPayloadWithLedgerFallback(req.supabase, req.appUser.id, req.appUser.role);
}

async function guardWithdrawEnabled(req) {
  const sbSvc = createServiceClient();
  if (sbSvc) await assertWithdrawEnabledPay(sbSvc);
}

function mapLedgerTxForWalletUi(t) {
  const dir = String(t.direction || "").toLowerCase();
  const rawType = String(t.type || "").toLowerCase();
  const desc = String(t.description || t.note || "");
  const ref = String(t.reference_id || "");
  let displayType = rawType;
  if (dir === "credit") {
    displayType = rawType === "earning" ? "earning" : "credit";
  } else if (dir === "debit") {
    displayType = rawType === "withdraw" ? "withdraw" : "debit";
  }
  let type_label = null;
  if (rawType === "payment" && dir === "debit" && /ervenow pay/i.test(desc)) {
    type_label = "شراء عبر ERVENOW PAY";
  } else if (rawType === "payment" && dir === "debit" && ref.startsWith("pay:order:")) {
    type_label = "شراء عبر ERVENOW PAY";
  }
  const orderMatch = ref.match(/^pay:order:([0-9a-f-]{36})$/i);
  return {
    ...t,
    type: displayType,
    direction: dir || t.direction,
    note: t.note || t.description || null,
    type_label,
    order_id: orderMatch ? orderMatch[1] : null,
    status_label:
      String(t.status || "").toLowerCase() === "pending"
        ? "معلّق"
        : String(t.status || "").toLowerCase() === "completed"
          ? "مكتمل"
          : String(t.status || "") || null,
  };
}

async function validateWithdrawRequest(req, amount) {
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
    throw new Error(`الحد الأدنى للسحب ${MIN_WITHDRAW} ريال`);
  }

  const { data: u, error: uErr } = await req.supabase
    .from("users")
    .select("iban, payout_iban_fingerprint")
    .eq("id", req.appUser.id)
    .single();
  if (uErr) throw new Error(uErr.message);
  const ibanRaw = u && u.iban != null ? String(u.iban).trim().replace(/\s+/g, "") : "";
  if (!ibanRaw) throw new Error("لا يوجد حساب بنكي (IBAN) مسجّل");
  if (!isValidIBAN(ibanRaw)) {
    throw new Error("IBAN غير صالح — يُقبل آيبان سعودي SA متبوعاً بـ 22 رقماً");
  }

  const submitted = stripIban(req.body?.iban);
  if (!submitted) {
    throw new Error("أدخل الآيبان مطابقاً لما سجّلته في الحساب لتأكيد طلب السحب");
  }
  if (stripIban(submitted) !== stripIban(ibanRaw)) {
    throw new Error("الآيبان المُدخل لا يطابق بيانات الحساب المسجّلة");
  }
  if (u.payout_iban_fingerprint) {
    const fp = ibanFingerprintFromPlain(submitted);
    if (fp && fp !== u.payout_iban_fingerprint) {
      throw new Error("الآيبان لا يطابق بيانات الحساب المسجّلة (تحقق من التطابق الكامل)");
    }
  }

  const balInfo = await getWithdrawAvailableBalance(req.supabase, req.appUser.id, req.appUser.role);
  const bal = Number(balInfo.balance) || 0;
  if (amount > bal) throw new Error("الرصيد غير كافٍ");

  return { ibanRaw, bal, balance_source: balInfo.source };
}

router.get("/me", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const payload = await getWalletMePayload(req.supabase, req.appUser.id, req.appUser.role);
    ok(res, payload);
  } catch (e) {
    fail(res, e.message || "تعذر تحميل المحفظة", 500);
  }
});

router.get("/", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const payload = await operationalWalletPayload(req);
    ok(res, payload);
  } catch (e) {
    fail(res, e.message || "تعذر تحميل المحفظة", 500);
  }
});

router.get("/transactions", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const transactions = await listLedgerWalletTransactions(
      req.supabase,
      req.appUser.id,
      req.appUser.role,
      Number(req.query?.limit) || 100
    );
    const rows = (transactions || []).map(mapLedgerTxForWalletUi);
    ok(res, { transactions: rows, wallet_mode: "ledger", source: "ervenow_ledger_transactions" });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/ledger/deposit", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const userId = String(req.body?.user_id || req.body?.target_user_id || "").trim();
    const amount = Number(req.body?.amount);
    const roleHint = String(req.body?.role || "customer").trim();
    if (!userId) return fail(res, "user_id مطلوب", 400);
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, "مبلغ غير صالح", 400);
    const reference_id =
      String(req.body?.reference_id || "").trim() || `admin_deposit:${Date.now()}:${userId.slice(0, 8)}`;
    const description = String(req.body?.description || "إيداع إداري (ledger)").trim();

    const { data, error } = await req.supabase.rpc("ervenow_ledger_deposit", {
      p_user_id: userId,
      p_role: roleHint,
      p_amount: amount,
      p_reference_id: reference_id,
      p_description: description,
    });
    if (error) return fail(res, error.message, 400);
    const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    if (row.ok === true || row.ok === "true") {
      try {
        await createNotification(req.supabase, {
          recipient_type: walletRecipientTypeByRole(roleHint),
          recipient_id: userId,
          title: "تم شحن المحفظة",
          message: "تم إضافة الرصيد إلى محفظتك بنجاح.",
          type: "wallet",
          source: "wallet",
          payload: {
            amount: Number(amount || 0),
            currency: "SAR",
            reference: reference_id,
            wallet_id: row.wallet_id || null,
          },
        });
      } catch (_e) {}
      return ok(res, { result: row, wallet_mode: "ledger" });
    }
    return fail(res, String(row.reason || "deposit_failed"), 400);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/ledger/pay", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const orderId = String(req.body?.order_id || "").trim();
    const amount = Number(req.body?.amount);
    if (!orderId) return fail(res, "order_id مطلوب", 400);
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, "مبلغ غير صالح", 400);
    const description = String(req.body?.description || "دفع من محفظة ledger").trim();

    const { data, error } = await req.supabase.rpc("ervenow_ledger_pay", {
      p_user_id: req.appUser.id,
      p_amount: amount,
      p_order_id: orderId,
      p_description: description,
    });
    if (error) return fail(res, error.message, 400);
    const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    if (row.ok === true || row.ok === "true") return ok(res, { result: row, wallet_mode: "ledger" });
    if (String(row.reason) === "insufficient_balance") {
      return fail(res, "الرصيد غير كافٍ", 400, { balance: row.balance });
    }
    return fail(res, String(row.reason || "pay_failed"), 400);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/ledger/refund", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const userId = String(req.body?.user_id || "").trim();
    const amount = Number(req.body?.amount);
    const reference_id = String(req.body?.reference_id || "").trim();
    const description = String(req.body?.description || "استرجاع إداري (ledger)").trim();
    if (!userId) return fail(res, "user_id مطلوب", 400);
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, "مبلغ غير صالح", 400);
    if (!reference_id) return fail(res, "reference_id مطلوب", 400);

    const { data, error } = await req.supabase.rpc("ervenow_ledger_refund", {
      p_user_id: userId,
      p_amount: amount,
      p_reference_id: reference_id,
      p_description: description,
      p_role: String(req.body?.role || "customer").trim(),
    });
    if (error) return fail(res, error.message, 400);
    const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    if (row.ok === true || row.ok === "true") {
      try {
        await createNotification(req.supabase, {
          recipient_type: walletRecipientTypeByRole(req.body?.role || "customer"),
          recipient_id: userId,
          title: "تم استرداد مبلغ",
          message: "تمت إعادة المبلغ إلى محفظتك.",
          type: "wallet",
          source: "wallet",
          payload: {
            amount: Number(amount || 0),
            currency: "SAR",
            reference: reference_id,
            wallet_id: row.wallet_id || null,
          },
        });
      } catch (_e) {}
      return ok(res, { result: row, wallet_mode: "ledger" });
    }
    return fail(res, String(row.reason || "refund_failed"), 400);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/pay-settings", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const settings = await loadPlatformPaySettings(sb);
    return ok(res, { settings });
  } catch (e) {
    return fail(res, e.message || "تعذر تحميل الإعدادات", 500);
  }
});

router.post("/topup-request", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const result = await createTopupRequest(req.supabase, req.appUser, req.body || {});
    if (result && result.auto_fulfilled === true) {
      try {
        await createNotification(req.supabase, {
          recipient_type: walletRecipientTypeByRole(req.appUser.role),
          recipient_id: req.appUser.id,
          title: "تم شحن المحفظة",
          message: "تم إضافة الرصيد إلى محفظتك بنجاح.",
          type: "wallet",
          source: "wallet",
          payload: {
            amount: Number(result.amount_credited || req.body?.amount || 0),
            currency: "SAR",
            reference: result.code || null,
            wallet_id: null,
          },
        });
      } catch (_e) {}
    }
    return ok(res, result);
  } catch (e) {
    return fail(res, e.message || "تعذر إنشاء طلب الشحن", e.statusCode || 500);
  }
});

router.post("/redeem-code", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const code = req.body?.code;
    const result = await redeemTopupCode(req.supabase, req.appUser, code);
    try {
      await createNotification(req.supabase, {
        recipient_type: walletRecipientTypeByRole(req.appUser.role),
        recipient_id: req.appUser.id,
        title: "تم شحن المحفظة",
        message: "تم إضافة الرصيد إلى محفظتك بنجاح.",
        type: "wallet",
        source: "wallet",
        payload: {
          amount: Number(result.amount || 0),
          currency: "SAR",
          reference: result.code || String(code || "").trim() || null,
          wallet_id: null,
        },
      });
    } catch (_e) {}
    return ok(res, result);
  } catch (e) {
    return fail(res, e.message || "تعذر تفعيل الكود", e.statusCode || 500);
  }
});

router.post("/transfer", requireAuth, requireRole(...WALLET_READ_ROLES), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const settings = await loadPlatformPaySettings(sb);
    if (!settings.wallet_transfer_enabled) {
      return fail(res, "التحويل غير متاح حالياً", 403);
    }
    return fail(res, "التحويل بين المستخدمين غير مفعّل في هذه النسخة", 501);
  } catch (e) {
    return fail(res, e.message || "تعذر التحويل", e.statusCode || 500);
  }
});

router.get("/withdraw", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    const { rows, source } = await listLedgerWithdrawRequests(req.supabase, req.appUser.id, {
      limit: Number(req.query?.limit) || 50,
    });
    ok(res, { requests: rows, source });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/withdraw", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    await guardWithdrawEnabled(req);
    const sbSvc = createServiceClient();
    if (sbSvc) await assertWithdrawSystemEnabled(sbSvc);

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
      return fail(res, `الحد الأدنى للسحب ${MIN_WITHDRAW} ريال`, 400);
    }

    const { ibanRaw } = await validateWithdrawRequest(req, amount);

    const { error: insE } = await req.supabase.from("ervenow_withdraw_requests").insert({
      user_id: req.appUser.id,
      amount,
      iban: ibanRaw,
      status: "pending",
    });
    if (insE) {
      const msg = String(insE.message || "");
      if (/ervenow_withdraw_requests|schema cache|relation/i.test(msg)) {
        return fail(
          res,
          "جدول طلبات السحب غير موجود. نفّذ shared/migration_withdraw_ledger_only_final.sql في Supabase SQL Editor.",
          503
        );
      }
      return fail(res, insE.message, 400);
    }
    await insertAuditEvent(req.supabase, {
      scope: "wallet",
      action: "withdraw_request_created",
      actor_type: "user",
      actor_id: req.appUser.id,
      subject_type: "ervenow_withdraw_requests",
      ip: clientIp(req),
      metadata: { amount, path: "ledger_only" },
    });
    return ok(res, { message: "تم إرسال طلب السحب", source: "ervenow_withdraw_requests" });
  } catch (e) {
    fail(res, e.message, e.statusCode || 500);
  }
});

router.post("/withdraw/send-otp", requireAuth, requireRole(...PAYOUT_ROLES), async (req, res) => {
  try {
    await guardWithdrawEnabled(req);
    const amount = Number(req.body?.amount);
    const { ibanRaw } = await validateWithdrawRequest(req, amount);

    const phone = String(req.appUser?.phone || "").trim();
    if (!phone) return fail(res, "رقم جوال المندوب غير متوفر", 400);

    const code = genOtp();
    const mode = otpBackendMode();
    const subjectKey = String(req.appUser.id);
    const started = await startOtpChallenge({
      sb: req.supabase,
      mode,
      scope: OTP_SCOPE.WALLET_WITHDRAW,
      subjectKey,
      code,
      ttlMs: WITHDRAW_OTP_TTL_MS,
      ip: clientIp(req),
      extras: { amount, iban: ibanRaw },
    });
    if (!started.ok) {
      return fail(res, started.error || "تعذر إعداد رمز التحقق", started.cooldownSeconds ? 429 : 400, {
        lock_seconds: started.cooldownSeconds,
        cooldown_seconds: started.cooldownSeconds,
      });
    }

    let sent = false;
    try {
      sent = await sendWhatsApp({
        to: phone,
        message: buildAuthOtpMessage(code, "سحب المحفظة"),
      });
    } catch (_e) {
      sent = false;
    }

    if (!sent) {
      await invalidateOtpChallenge({
        sb: req.supabase,
        mode: otpBackendMode(),
        scope: OTP_SCOPE.WALLET_WITHDRAW,
        subjectKey: String(req.appUser.id),
      });
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
    await guardWithdrawEnabled(req);
    const sbSvc = createServiceClient();
    if (sbSvc) await assertWithdrawSystemEnabled(sbSvc);

    const code = String(req.body?.code || "").trim();
    if (!code) return fail(res, "رمز التحقق مطلوب", 400);

    const mode = otpBackendMode();
    const checked = await verifyOtpChallenge({
      sb: req.supabase,
      mode,
      scope: OTP_SCOPE.WALLET_WITHDRAW,
      subjectKey: String(req.appUser.id),
      code,
    });
    if (!checked.ok) {
      const lockCase = /قفل|محاولات كثيرة/i.test(String(checked.error || ""));
      return fail(res, checked.error || "رمز التحقق غير صحيح", lockCase ? 429 : 400, {
        attempts_remaining: checked.attemptsRemaining,
      });
    }

    const meta = checked.metadata || {};
    const amount = Number(req.body?.amount) || Number(meta.amount);
    const mergedBody = { ...(req.body || {}), iban: req.body?.iban || meta.iban, amount };
    const mergedReq = { ...req, body: mergedBody };
    const { ibanRaw } = await validateWithdrawRequest(mergedReq, amount);

    const { error: insE } = await req.supabase.from("ervenow_withdraw_requests").insert({
      user_id: req.appUser.id,
      amount,
      iban: ibanRaw,
      status: "pending",
      note: "OTP verified",
    });
    if (insE) {
      const msg = String(insE.message || "");
      if (/ervenow_withdraw_requests|schema cache|relation/i.test(msg)) {
        return fail(
          res,
          "جدول طلبات السحب غير موجود. نفّذ shared/migration_withdraw_ledger_only_final.sql في Supabase SQL Editor.",
          503
        );
      }
      return fail(res, insE.message, 400);
    }
    await insertAuditEvent(req.supabase, {
      scope: "wallet",
      action: "withdraw_request_created",
      actor_type: "user",
      actor_id: req.appUser.id,
      subject_type: "ervenow_withdraw_requests",
      ip: clientIp(req),
      metadata: { amount, path: "ledger_only_otp" },
    });
    return ok(res, {
      message: "تم إرسال طلب السحب بنجاح بعد التحقق",
      source: "ervenow_withdraw_requests",
    });
  } catch (e) {
    return fail(res, e.message, e.statusCode || 400);
  }
});

module.exports = router;
