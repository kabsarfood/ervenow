/**
 * Pay Link — سداد ديون + بوابة الدفع + Auto Unfreeze.
 */

const express = require("express");
const { ok, fail } = require("../../shared/utils/helpers");
const { createServiceClient } = require("../../shared/config/supabase");
const { round2 } = require("../../shared/utils/operationalWallet");
const { buildDebtPaymentLink, getPublicSiteBase } = require("../../shared/utils/debtPaymentLink");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const { loadAutoFreezeSettings, evaluateAutoFreezeBalance, toAutoFreezeBalance } = require("../../shared/services/autoFreeze");
const { gatewayMode, createPaymentCheckoutSession, verifyWebhookPayment } = require("../../shared/services/paymentGateway");
const {
  resolveDebtSnapshot,
  getPaymentSession,
  settleDebtPaymentSession,
  findSessionByGatewayId,
  isSessionsTableMissing,
} = require("../../shared/services/debtPaymentSettlement");
const { logger } = require("../../shared/utils/logger");

const router = express.Router();

const METHOD_LABELS = {
  ew_pay: "ERVENOW Pay",
  mada: "مدى",
  visa: "Visa",
  mastercard: "Mastercard",
  apple_pay: "Apple Pay",
  stc_pay: "STC Pay",
  tabby: "Tabby",
  tamara: "Tamara",
};

function maskUserId(uid) {
  const s = String(uid || "");
  if (s.length <= 10) return s.slice(0, 4) + "…";
  return s.slice(0, 8) + "…";
}

/**
 * GET /api/pay/debt-info?uid=&amount=&type=debt
 */
router.get("/debt-info", async (req, res) => {
  try {
    const uid = String(req.query.uid || req.query.userId || "").trim();
    const type = String(req.query.type || "debt").trim().toLowerCase();
    const amountReq = Number(req.query.amount);

    if (!uid) return fail(res, "uid required", 400);
    if (type !== "debt") return fail(res, "unsupported type", 400);

    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);

    const { data: user, error: uErr } = await sb.from("users").select("id, role, phone").eq("id", uid).maybeSingle();
    if (uErr) return fail(res, uErr.message, 400);
    if (!user?.id) return fail(res, "المستخدم غير موجود", 404);

    const snap = await resolveDebtSnapshot(sb, uid);
    const requested =
      Number.isFinite(amountReq) && amountReq > 0 ? round2(amountReq) : snap.total_owed > 0 ? snap.total_owed : null;

    const freezeSettings = await loadAutoFreezeSettings(sb);
    const freezeSt =
      snap.driver_owed > 0
        ? evaluateAutoFreezeBalance(toAutoFreezeBalance(snap.driver_owed), freezeSettings.config, freezeSettings.mode)
        : { phase: "none" };

    const methodsRaw = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
    const methods = [];
    for (const [key, enabled] of Object.entries(methodsRaw || {})) {
      if (!enabled || key === "cash_on_delivery") continue;
      methods.push({ key, label: METHOD_LABELS[key] || key });
    }

    const payment_link = buildDebtPaymentLink(uid, requested || snap.total_owed || amountReq || 0);
    const supportPhone = String(process.env.ERVENOW_SUPPORT_PHONE || process.env.ERVENOW_ADMIN_LOGIN_PHONE || "").trim();

    return ok(res, {
      ok: true,
      type: "debt",
      user_id: uid,
      user_masked: maskUserId(uid),
      role: user.role || null,
      amount_requested: requested,
      amount_due: snap.total_owed,
      driver_owed: snap.driver_owed,
      ledger_owed: snap.ledger_owed,
      has_debt: snap.total_owed > 0,
      debt_source:
        snap.total_owed > 0
          ? snap.ledger_owed > 0
            ? "ervenow_ledger"
            : snap.driver_owed > 0
              ? "driver_wallets"
              : "ervenow_ledger"
          : "none",
      payment_link,
      gateway_mode: gatewayMode(),
      auto_freeze: {
        active: freezeSettings.auto,
        phase: freezeSt.phase || "none",
        is_frozen: freezeSt.phase === "block",
        warning: freezeSt.phase === "warn",
      },
      payment_methods: methods,
      support_phone: supportPhone || null,
      note:
        snap.total_owed > 0
          ? "ادفع إلكترونياً عبر الزر أدناه أو تواصل مع الإدارة."
          : "لا توجد مستحقات مسجّلة حالياً على هذا الحساب.",
    });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/**
 * POST /api/pay/create-session
 * Body: { uid, amount, type: "debt" }
 */
router.post("/create-session", async (req, res) => {
  try {
    const uid = String(req.body?.uid || req.body?.userId || "").trim();
    const type = String(req.body?.type || "debt").trim().toLowerCase();
    const amountRaw = Number(req.body?.amount);

    if (!uid) return fail(res, "uid required", 400);
    if (type !== "debt") return fail(res, "unsupported type", 400);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) return fail(res, "amount must be positive", 400);

    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);

    const { data: user, error: uErr } = await sb.from("users").select("id").eq("id", uid).maybeSingle();
    if (uErr) return fail(res, uErr.message, 400);
    if (!user?.id) return fail(res, "المستخدم غير موجود", 404);

    const amount = round2(amountRaw);
    const snap = await resolveDebtSnapshot(sb, uid);
    if (snap.total_owed > 0 && amount > snap.total_owed + 0.01) {
      return fail(res, `المبلغ أكبر من المستحق (${snap.total_owed.toFixed(2)} ر.س)`, 400);
    }

    const base = getPublicSiteBase();
    const callbackUrl =
      `${base}/pay?uid=${encodeURIComponent(uid)}&amount=${encodeURIComponent(amount.toFixed(2))}` +
      `&type=debt&paid=1`;

    const { data: sessionRow, error: insErr } = await sb
      .from("debt_payment_sessions")
      .insert({
        user_id: uid,
        amount,
        pay_type: type,
        status: "pending",
        gateway: gatewayMode(),
        metadata: { callback_url: callbackUrl },
      })
      .select("id, user_id, amount, status, gateway, created_at")
      .single();

    if (insErr) {
      if (isSessionsTableMissing(insErr)) {
        return fail(res, "نفّذ shared/migration_debt_payment_sessions.sql على Supabase", 503);
      }
      return fail(res, insErr.message, 400);
    }

    const sessionId = String(sessionRow.id);
    const checkout = await createPaymentCheckoutSession({
      sessionId,
      amountSar: amount,
      description: `سداد مستحقات ERVENOW — ${maskUserId(uid)}`,
      callbackUrl,
      metadata: { user_id: uid, pay_type: type, session_id: sessionId },
    });

    await sb
      .from("debt_payment_sessions")
      .update({
        gateway: checkout.gateway,
        gateway_payment_id: checkout.gateway_payment_id,
        gateway_invoice_id: checkout.gateway_invoice_id,
        checkout_url: checkout.checkout_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return ok(res, {
      ok: true,
      session_id: sessionId,
      checkout_url: checkout.checkout_url,
      gateway: checkout.gateway,
      amount,
      user_id: uid,
      payment_link: buildDebtPaymentLink(uid, amount),
    });
  } catch (e) {
    logger.error({ err: e.message || String(e) }, "[pay] create-session");
    return fail(res, e.message || String(e), 500);
  }
});

/**
 * POST /api/pay/webhook — Moyasar أو mock
 */
router.post("/webhook", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const sb = createServiceClient();
    if (!sb) return res.status(503).json({ ok: false, error: "db_unavailable" });

    if (gatewayMode() === "mock") {
      const secret = String(process.env.PAY_WEBHOOK_SECRET || process.env.PAY_MOCK_WEBHOOK_SECRET || "").trim();
      const hdr = String(req.headers["x-pay-webhook-secret"] || req.headers["x-ervenow-pay-secret"] || "").trim();
      if (secret && hdr !== secret) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    const verified = await verifyWebhookPayment(body);
    if (!verified.paid) {
      return res.status(200).json({ ok: true, ignored: true, reason: verified.reason || "not_paid" });
    }

    const meta = verified.metadata || body.metadata || {};
    let session =
      meta.session_id ? await getPaymentSession(sb, meta.session_id) : null;
    if (!session) {
      session = await findSessionByGatewayId(sb, verified.gateway_payment_id);
    }
    if (!session) {
      logger.warn({ gatewayId: verified.gateway_payment_id }, "[pay/webhook] session not found");
      return res.status(404).json({ ok: false, error: "session_not_found" });
    }

    const result = await settleDebtPaymentSession(sb, session, {
      gateway_payment_id: verified.gateway_payment_id,
      webhook: { amount_sar: verified.amount_sar, status: "paid" },
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e.code === "MIGRATION_MISSING") {
      return res.status(503).json({ ok: false, error: e.message });
    }
    logger.error({ err: e.message || String(e) }, "[pay/webhook]");
    return res.status(500).json({ ok: false, error: e.message || "webhook_error" });
  }
});

/** POST /api/pay/mock-complete — تطوير فقط (PAYMENT_GATEWAY=mock) */
router.post("/mock-complete", async (req, res) => {
  if (gatewayMode() !== "mock") return fail(res, "mock gateway only", 403);
  try {
    const sessionId = String(req.body?.session_id || req.body?.sessionId || "").trim();
    if (!sessionId) return fail(res, "session_id required", 400);
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const session = await getPaymentSession(sb, sessionId);
    if (!session) return fail(res, "session not found", 404);

    const verified = {
      paid: true,
      gateway_payment_id: session.gateway_payment_id || `mock_pay_${sessionId}`,
      amount_sar: Number(session.amount),
      metadata: { session_id: sessionId, user_id: session.user_id },
      raw: { mock: true },
    };

    const result = await settleDebtPaymentSession(sb, session, {
      gateway_payment_id: verified.gateway_payment_id,
      webhook: verified,
    });
    return ok(res, result);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
