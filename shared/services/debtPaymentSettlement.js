/**
 * تسوية سداد الديون — ledger_only: ervenow_ledger_deposit فقط.
 */

const { round2 } = require("../utils/operationalWallet");
const { logger } = require("../utils/logger");
const { isLedgerOnlyMode } = require("../utils/financeMode");
const { collectDriverCommission, getDriverCommissionBalance } = require("./driverCommissionLedger");
const {
  getLedgerUserWalletSummary,
  getDriverLedgerOwedBalance,
  collectDriverDebtViaLedger,
} = require("../utils/ledgerWallet");
const { mapAppRoleToLedgerWalletRole } = require("../utils/ervenowLedgerWallet");
const { tryAutoUnfreezeAfterPayment } = require("./autoUnfreeze");

function isSessionsTableMissing(err) {
  const msg = String(err?.message || err || "");
  return /debt_payment_sessions|does not exist|schema cache/i.test(msg);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 */
async function resolveDebtSnapshot(sb, userId) {
  const uid = String(userId || "").trim();
  let driver_balance = 0;
  let ledger_balance = 0;
  let ledger_role = "driver";

  const { data: user } = await sb.from("users").select("id, role").eq("id", uid).maybeSingle();
  const appRole = user?.role === "driver" ? "driver" : user?.role || "customer";
  ledger_role = mapAppRoleToLedgerWalletRole(appRole);
  const ledger = await getLedgerUserWalletSummary(sb, uid, appRole);
  if (ledger.ok) {
    ledger_balance = round2(Number(ledger.balance) || 0);
  }

  let driver_owed = 0;
  let ledger_owed = ledger_balance < 0 ? round2(Math.abs(ledger_balance)) : 0;

  if (isLedgerOnlyMode()) {
    driver_owed = 0;
    ledger_owed = await getDriverLedgerOwedBalance(sb, uid);
    if (ledger_owed <= 0 && ledger_balance < 0) {
      ledger_owed = round2(Math.abs(ledger_balance));
    }
  } else {
    driver_balance = await getDriverCommissionBalance(sb, uid);
    driver_owed = round2(Math.max(0, driver_balance));
    ledger_owed = ledger_balance < 0 ? round2(Math.abs(ledger_balance)) : 0;
  }

  const total_owed = round2(driver_owed + ledger_owed);

  return {
    user_id: uid,
    driver_owed,
    ledger_owed,
    total_owed,
    ledger_role,
    ledger_balance,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} sessionId
 */
async function getPaymentSession(sb, sessionId) {
  const id = String(sessionId || "").trim();
  const { data, error } = await sb.from("debt_payment_sessions").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isSessionsTableMissing(error)) {
      const e = new Error("debt_payment_sessions migration missing");
      e.code = "MIGRATION_MISSING";
      throw e;
    }
    throw error;
  }
  return data;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} session
 * @param {{ gateway_payment_id?: string, webhook?: object }} ctx
 */
async function settleDebtPaymentSession(sb, session, ctx = {}) {
  const sid = String(session.id);
  if (session.status === "paid") {
    return { ok: true, already_settled: true, session_id: sid };
  }

  const uid = String(session.user_id);
  let remaining = round2(Number(session.amount) || 0);
  if (remaining <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  const settlement = {
    driver: null,
    ledger: [],
    remaining: remaining,
  };

  const snap = await resolveDebtSnapshot(sb, uid);
  const gatewayRef = ctx.gateway_payment_id || session.gateway_payment_id || sid;

  if (!isLedgerOnlyMode() && snap.driver_owed > 0 && remaining > 0) {
    const apply = round2(Math.min(remaining, snap.driver_owed));
    try {
      const row = await collectDriverCommission(sb, uid, apply, {
        source: "payment_gateway",
        session_id: sid,
        gateway_payment_id: gatewayRef,
        pay_type: session.pay_type || "debt",
      });
      settlement.driver = { amount: apply, result: row };
      if (row.ok === true || row.ok === "true") {
        remaining = round2(remaining - apply);
      }
    } catch (e) {
      logger.error({ err: e.message, uid, sid }, "[debt_settlement] driver collect");
      settlement.driver = { amount: apply, error: e.message };
    }
  }

  const ledgerOwedApply = isLedgerOnlyMode()
    ? round2(Math.min(remaining, snap.total_owed || snap.ledger_owed))
    : round2(Math.min(remaining, snap.ledger_owed));

  if (remaining > 0 && ledgerOwedApply > 0) {
    const apply = ledgerOwedApply;
    try {
      let data;
      let error;
      if (isLedgerOnlyMode()) {
        const row = await collectDriverDebtViaLedger(sb, uid, apply, {
          receipt_reference: `pay:debt:${sid}`,
          note: "سداد — بوابة الدفع",
        });
        data = row;
        error = null;
      } else {
        ({ data, error } = await sb.rpc("ervenow_ledger_deposit", {
          p_user_id: uid,
          p_role: snap.ledger_role,
          p_amount: apply,
          p_reference_id: `pay:debt:${sid}`,
          p_description: "سداد مستحقات — بوابة الدفع",
        }));
      }
      if (error) throw error;
      settlement.ledger.push({ amount: apply, role: snap.ledger_role, result: data });
      const row = typeof data === "object" && data !== null ? data : {};
      if (row.ok === true || row.ok === "true") {
        remaining = round2(remaining - apply);
      }
    } catch (e) {
      if (!/ervenow_ledger|does not exist|function.*not found/i.test(String(e.message || ""))) {
        logger.error({ err: e.message, uid, sid }, "[debt_settlement] ledger deposit");
      }
      settlement.ledger.push({ amount: apply, error: e.message });
    }
  }

  settlement.remaining = remaining;
  settlement.snapshot_after = await resolveDebtSnapshot(sb, uid);

  const paidAt = new Date().toISOString();
  const { error: upErr } = await sb
    .from("debt_payment_sessions")
    .update({
      status: "paid",
      paid_at: paidAt,
      gateway_payment_id: gatewayRef,
      settlement,
      updated_at: paidAt,
      metadata: {
        ...(session.metadata || {}),
        webhook: ctx.webhook || null,
      },
    })
    .eq("id", sid)
    .eq("status", "pending");

  if (upErr) throw upErr;

  const unfreeze = await tryAutoUnfreezeAfterPayment(sb, uid, {
    payment_amount: round2(Number(session.amount) || 0),
  });

  console.log("[debt_payment] settled:", sid, "user:", uid.slice(0, 8), "unfreeze:", unfreeze.unfrozen);

  return {
    ok: true,
    session_id: sid,
    user_id: uid,
    amount: round2(Number(session.amount) || 0),
    settlement,
    auto_unfreeze: unfreeze,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} gatewayPaymentId
 */
async function findSessionByGatewayId(sb, gatewayPaymentId) {
  const gid = String(gatewayPaymentId || "").trim();
  if (!gid) return null;

  const { data: byPay, error: e1 } = await sb
    .from("debt_payment_sessions")
    .select("*")
    .eq("gateway_payment_id", gid)
    .maybeSingle();
  if (e1 && !isSessionsTableMissing(e1)) throw e1;
  if (byPay) return byPay;

  const { data: byInv, error: e2 } = await sb
    .from("debt_payment_sessions")
    .select("*")
    .eq("gateway_invoice_id", gid)
    .maybeSingle();
  if (e2 && !isSessionsTableMissing(e2)) throw e2;
  return byInv;
}

module.exports = {
  isSessionsTableMissing,
  resolveDebtSnapshot,
  getPaymentSession,
  settleDebtPaymentSession,
  findSessionByGatewayId,
};
