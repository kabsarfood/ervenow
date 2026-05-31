/**
 * قراءة/كتابة مالية — ervenow_ledger_* فقط (FINANCE_MODE=ledger_only).
 */

const { mapAppRoleToLedgerWalletRole } = require("./ervenowLedgerWallet");
const { round2 } = require("./operationalWallet");
const { isLedgerOnlyMode, legacyFinanceDisabledMessage } = require("./financeMode");
const { isFeatureEnabled, isFeatureAuto, loadFinancialFeatureFlags } = require("./platformFeatureFlags");
const { buildDebtPaymentLink } = require("./debtPaymentLink");

/** تجنّب circular dependency مع autoFreeze (يستورد ledgerWallet أيضاً) */
function getListAutoFreezeDashboardAlerts() {
  const { listAutoFreezeDashboardAlerts } = require("../services/autoFreeze");
  return listAutoFreezeDashboardAlerts;
}
const { processDebtNotifyFromFinanceSummary } = require("../services/financialDebtNotify");

function isMissingLedgerSchemaError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || err);
  return /ervenow_ledger|does not exist|schema cache|PGRST205|42P01|function.*not found/i.test(msg);
}

function parseSummaryRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {string} appRole
 * @param {number} [limit]
 */
async function listLedgerWalletTransactions(sb, userId, appRole, limit = 10) {
  const uid = String(userId || "").trim();
  if (!uid || !sb) return [];

  const ledgerRole = mapAppRoleToLedgerWalletRole(appRole);
  const cap = Math.min(Math.max(Number(limit) || 10, 1), 100);

  try {
    const { data: wallet, error: wErr } = await sb
      .from("ervenow_ledger_wallets")
      .select("id")
      .eq("user_id", uid)
      .eq("role", ledgerRole)
      .maybeSingle();

    if (wErr) {
      if (isMissingLedgerSchemaError(wErr)) return [];
      throw wErr;
    }
    if (!wallet?.id) return [];

    const { data, error } = await sb
      .from("ervenow_ledger_transactions")
      .select("id, type, direction, amount, status, reference_id, description, created_at")
      .eq("wallet_id", wallet.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(cap);

    if (error) {
      if (isMissingLedgerSchemaError(error)) return [];
      throw error;
    }
    return data || [];
  } catch (e) {
    if (isMissingLedgerSchemaError(e)) return [];
    throw e;
  }
}

/**
 * حساب الرصيد من حركات ledger: SUM(credit) - SUM(debit)
 * @param {Array<{ direction?: string, amount?: number, type?: string }>} transactions
 */
function aggregateLedgerTransactions(transactions) {
  let creditSum = 0;
  let debitSum = 0;
  let totalEarned = 0;
  let totalCommission = 0;

  for (const t of transactions || []) {
    const amt = Number(t.amount) || 0;
    if (t.direction === "credit") {
      creditSum += amt;
      if (t.type === "earning" || t.type === "deposit") totalEarned += amt;
    } else if (t.direction === "debit") {
      debitSum += amt;
      if (t.type === "commission") totalCommission += amt;
    }
  }

  return {
    balance: round2(creditSum - debitSum),
    total_earned: round2(totalEarned),
    total_commission: round2(totalCommission),
    transaction_count: (transactions || []).length,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {string} appRole
 */
async function computeLedgerWalletFromAllTransactions(sb, userId, appRole) {
  const uid = String(userId || "").trim();
  if (!uid || !sb) return { ok: false, has_data: false };

  const ledgerRole = mapAppRoleToLedgerWalletRole(appRole);

  try {
    const { data: wallet, error: wErr } = await sb
      .from("ervenow_ledger_wallets")
      .select("id")
      .eq("user_id", uid)
      .eq("role", ledgerRole)
      .maybeSingle();

    if (wErr) {
      if (isMissingLedgerSchemaError(wErr)) return { ok: false, reason: "migration_missing", has_data: false };
      throw wErr;
    }
    if (!wallet?.id) {
      return {
        ok: true,
        has_data: false,
        wallet_id: null,
        balance: 0,
        total_earned: 0,
        total_commission: 0,
        transaction_count: 0,
        wallet_mode: "ledger",
        layer: "ervenow_ledger_transactions",
      };
    }

    const { data: txs, error: txErr } = await sb
      .from("ervenow_ledger_transactions")
      .select("type, direction, amount")
      .eq("wallet_id", wallet.id)
      .eq("status", "completed");

    if (txErr) {
      if (isMissingLedgerSchemaError(txErr)) return { ok: false, reason: "migration_missing", has_data: false };
      throw txErr;
    }

    const agg = aggregateLedgerTransactions(txs || []);
    const hasData =
      agg.transaction_count > 0 || agg.balance > 0 || agg.total_earned > 0 || agg.total_commission > 0;

    return {
      ok: true,
      has_data: hasData,
      wallet_id: wallet.id,
      ...agg,
      wallet_mode: "ledger",
      layer: "ervenow_ledger_transactions",
    };
  } catch (e) {
    if (isMissingLedgerSchemaError(e)) return { ok: false, reason: "migration_missing", has_data: false };
    throw e;
  }
}

function emptyLedgerWalletPayload(reason) {
  return {
    balance: 0,
    total_earned: 0,
    total_commission: 0,
    total_withdrawn: 0,
    last_transactions: [],
    wallet_mode: "ledger",
    source: "ervenow_ledger",
    wallet_id: null,
    ledger_reason: reason || null,
  };
}

/**
 * GET /api/wallet/me — ervenow_ledger_transactions فقط.
 */
async function getWalletMePayload(sb, userId, appRole) {
  let ledger = await computeLedgerWalletFromAllTransactions(sb, userId, appRole);
  if (!ledger.ok) {
    ledger = await getLedgerUserWalletSummary(sb, userId, appRole);
  }

  if (!ledger.ok) {
    if (ledger.reason === "migration_missing") {
      return {
        ...emptyLedgerWalletPayload("migration_missing"),
        setup_required: true,
        message: "نظام المحفظة غير مفعّل — نفّذ هجرة ledger في Supabase",
      };
    }
    return emptyLedgerWalletPayload(ledger.reason);
  }

  const last_transactions = await listLedgerWalletTransactions(sb, userId, appRole, 10);
  return {
    balance: ledger.balance,
    total_earned: ledger.total_earned,
    total_commission: ledger.total_commission,
    total_withdrawn: 0,
    last_transactions,
    wallet_mode: "ledger",
    source: "ervenow_ledger",
    wallet_id: ledger.wallet_id || null,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function getLedgerUserWalletSummary(sb, userId, appRole) {
  const uid = String(userId || "").trim();
  if (!uid || !sb) {
    return { ok: false, reason: "missing_user_id", has_data: false };
  }

  const ledgerRole = mapAppRoleToLedgerWalletRole(appRole);

  try {
    const { data, error } = await sb.rpc("ervenow_ledger_user_wallet_summary", {
      p_user_id: uid,
      p_role: ledgerRole,
    });
    if (error) {
      if (isMissingLedgerSchemaError(error)) {
        return { ok: false, reason: "migration_missing", has_data: false };
      }
      throw error;
    }

    const row = parseSummaryRow(data);
    if (row.ok !== true && row.ok !== "true") {
      return { ok: false, reason: row.reason || "summary_failed", has_data: false };
    }

    const txCount = Number(row.transaction_count) || 0;
    const balance = round2(Number(row.balance) || 0);
    const totalEarned = round2(Number(row.total_earned) || 0);
    const totalCommission = round2(Number(row.total_commission) || 0);
    const hasData = txCount > 0 || balance > 0 || totalEarned > 0 || totalCommission > 0;

    return {
      ok: true,
      has_data: hasData,
      wallet_id: row.wallet_id || null,
      balance,
      total_earned: totalEarned,
      total_commission: totalCommission,
      transaction_count: txCount,
      wallet_mode: "ledger",
      layer: "ervenow_ledger_transactions",
    };
  } catch (e) {
    if (isMissingLedgerSchemaError(e)) {
      return { ok: false, reason: "migration_missing", has_data: false };
    }
    throw e;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {string} appRole
 */
async function getWalletPayloadWithLedgerFallback(sb, userId, appRole) {
  let ledger = await computeLedgerWalletFromAllTransactions(sb, userId, appRole);
  if (!ledger.ok) {
    ledger = await getLedgerUserWalletSummary(sb, userId, appRole);
  }

  if (!ledger.ok) {
    if (ledger.reason === "migration_missing") {
      return {
        ...emptyLedgerWalletPayload("migration_missing"),
        setup_required: true,
        message: "نظام المحفظة غير مفعّل — نفّذ هجرة ledger في Supabase",
      };
    }
    return emptyLedgerWalletPayload(ledger.reason);
  }

  return {
    balance: ledger.balance,
    total_earned: ledger.total_earned,
    total_commission: ledger.total_commission,
    wallet_mode: "ledger",
    layer: ledger.layer || "ervenow_ledger_transactions",
    wallet_id: ledger.wallet_id || null,
    source: "ervenow_ledger",
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {number} [limit]
 */
async function listRecentLedgerTransactionsForAdmin(sb, limit = 20) {
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from("ervenow_ledger_transactions")
      .select(
        "id, type, direction, amount, reference_id, created_at, wallet:ervenow_ledger_wallets(user_id, role, is_platform)"
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(cap);

    if (error) {
      if (isMissingLedgerSchemaError(error)) return [];
      throw error;
    }

    return (data || []).map((row) => {
      const wallet = row.wallet || {};
      let userId = wallet.user_id || null;
      if (!userId && wallet.is_platform) userId = "platform";
      return {
        id: row.id,
        type: row.type,
        direction: row.direction,
        amount: round2(Number(row.amount) || 0),
        user_id: userId,
        reference_id: row.reference_id || null,
        created_at: row.created_at,
      };
    });
  } catch (e) {
    if (isMissingLedgerSchemaError(e)) return [];
    throw e;
  }
}

/**
 * تنبيهات مالية ذكية من ervenow_ledger.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function computeFinancialAlertsFromLedger(sb) {
  const alerts = [];
  if (!sb) return alerts;

  const HIGH_DEBT = -300;
  const LARGE_WITHDRAW = 1000;
  const TX_BURST = 10;
  const minuteStart = new Date(Date.now() - 60_000).toISOString();
  const dayStart = new Date(Date.now() - 86_400_000).toISOString();

  try {
    const { data: debtWallets, error: debtErr } = await sb
      .from("ervenow_ledger_wallets")
      .select("id, user_id, role, balance")
      .not("user_id", "is", null)
      .lt("balance", HIGH_DEBT)
      .order("balance", { ascending: true })
      .limit(15);

    if (!debtErr) {
      for (const w of debtWallets || []) {
        const owed = Math.abs(Number(w.balance) || 0);
        const payment_link = w.user_id ? buildDebtPaymentLink(w.user_id, owed) : null;
        alerts.push({
          id: `high_debt:${w.user_id}:${w.role || "user"}`,
          type: "high_debt",
          severity: "danger",
          title: "دين عالي",
          message: `رصيد ${w.role || "مستخدم"} (${String(w.user_id).slice(0, 8)}…) = ${round2(Number(w.balance))} ر.س (أقل من ${HIGH_DEBT})`,
          user_id: w.user_id,
          amount: round2(Number(w.balance)),
          amount_due: round2(owed),
          role: w.role || null,
          payment_link,
        });
      }
    } else if (!isMissingLedgerSchemaError(debtErr)) {
      throw debtErr;
    }

    let withdrawRows = [];
    const { data: wrData, error: wrErr } = await sb
      .from("withdraw_requests")
      .select("id, user_id, amount, status, created_at")
      .gt("amount", LARGE_WITHDRAW)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(15);

    if (!wrErr) {
      withdrawRows = wrData || [];
    } else if (/withdraw_requests|does not exist|schema cache/i.test(String(wrErr.message || ""))) {
      const legacy = await sb
        .from("ervenow_withdraw_requests")
        .select("id, user_id, amount, status, created_at")
        .gt("amount", LARGE_WITHDRAW)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(15);
      if (!legacy.error) withdrawRows = legacy.data || [];
      else if (!isMissingLedgerSchemaError(legacy.error)) throw legacy.error;
    } else if (!isMissingLedgerSchemaError(wrErr)) {
      throw wrErr;
    }

    for (const r of withdrawRows) {
      const st = String(r.status || "pending");
      alerts.push({
        id: `large_withdraw:req:${r.id}`,
        type: "large_withdrawal",
        severity: st === "pending" ? "warn" : "danger",
        title: "سحب كبير",
        message: `طلب سحب ${round2(Number(r.amount))} ر.س — الحالة: ${st}`,
        user_id: r.user_id,
        amount: round2(Number(r.amount)),
        reference_id: r.id,
        status: st,
      });
    }

    const { data: bigWithdrawTxs, error: bwErr } = await sb
      .from("ervenow_ledger_transactions")
      .select("id, amount, created_at, wallet:ervenow_ledger_wallets(user_id, role)")
      .eq("status", "completed")
      .eq("type", "withdraw")
      .gt("amount", LARGE_WITHDRAW)
      .gte("created_at", dayStart)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!bwErr) {
      for (const tx of bigWithdrawTxs || []) {
        const uid = tx.wallet?.user_id || null;
        alerts.push({
          id: `large_withdraw:tx:${tx.id}`,
          type: "large_withdrawal",
          severity: "warn",
          title: "سحب كبير",
          message: `حركة سحب مكتملة بقيمة ${round2(Number(tx.amount))} ر.س`,
          user_id: uid,
          amount: round2(Number(tx.amount)),
          reference_id: tx.id,
        });
      }
    } else if (!isMissingLedgerSchemaError(bwErr)) {
      throw bwErr;
    }

    const { data: minuteTxs, error: txErr } = await sb
      .from("ervenow_ledger_transactions")
      .select("id, created_at, wallet:ervenow_ledger_wallets(user_id, role)")
      .eq("status", "completed")
      .gte("created_at", minuteStart);

    if (!txErr && (minuteTxs || []).length) {
      const byUser = new Map();
      for (const tx of minuteTxs) {
        const uid = tx.wallet?.user_id || "platform";
        const key = String(uid);
        const prev = byUser.get(key) || { count: 0, role: tx.wallet?.role || null };
        prev.count += 1;
        byUser.set(key, prev);
      }

      let flaggedUser = false;
      for (const [uid, info] of byUser) {
        if (info.count > TX_BURST) {
          flaggedUser = true;
          alerts.push({
            id: `abnormal:${uid}:${minuteStart}`,
            type: "abnormal_activity",
            severity: "danger",
            title: "نشاط غير طبيعي",
            message: `${info.count} عملية خلال دقيقة واحدة`,
            user_id: uid !== "platform" ? uid : null,
            count: info.count,
            role: info.role,
          });
        }
      }

      if (!flaggedUser && minuteTxs.length > TX_BURST) {
        alerts.push({
          id: `abnormal:global:${minuteStart}`,
          type: "abnormal_activity",
          severity: "warn",
          title: "نشاط غير طبيعي",
          message: `${minuteTxs.length} عملية مالية خلال دقيقة واحدة على مستوى النظام`,
          user_id: null,
          count: minuteTxs.length,
        });
      }
    } else if (txErr && !isMissingLedgerSchemaError(txErr)) {
      throw txErr;
    }
  } catch (e) {
    if (!isMissingLedgerSchemaError(e)) throw e;
  }

  return alerts.slice(0, 30);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function getAdminFinanceSummaryFromLedger(sb) {
  if (!sb) {
    return { ok: false, reason: "missing_client" };
  }

  try {
    const { data, error } = await sb.rpc("ervenow_ledger_finance_summary");
    if (error) {
      if (isMissingLedgerSchemaError(error)) {
        return { ok: false, reason: "migration_missing", detail: error.message };
      }
      throw error;
    }

    const row = parseSummaryRow(data);
    const flagPayload = await loadFinancialFeatureFlags(sb);
    const flags = flagPayload.flags || {};
    const alertsEnabled = isFeatureEnabled(flags.financial_alerts);

    const [recent_transactions, ledgerAlerts] = await Promise.all([
      listRecentLedgerTransactionsForAdmin(sb, 20),
      alertsEnabled ? computeFinancialAlertsFromLedger(sb) : Promise.resolve([]),
    ]);

    let financial_alerts = ledgerAlerts;
    if (isFeatureAuto(flags.auto_freeze)) {
      const listFreezeAlerts = getListAutoFreezeDashboardAlerts();
      if (typeof listFreezeAlerts === "function") {
        const freezeAlerts = await listFreezeAlerts(sb);
        financial_alerts = [...freezeAlerts, ...ledgerAlerts].slice(0, 40);
      }
    }

    if (alertsEnabled || isFeatureAuto(flags.auto_freeze)) {
      void processDebtNotifyFromFinanceSummary(sb, flags).catch((e) => {
        const { logger } = require("./logger");
        logger.warn({ err: e.message || String(e) }, "[financial_debt] finance-summary notify");
      });
    }

    return {
      ok: true,
      source: "ervenow_ledger",
      platform_commission_total: round2(Number(row.platform_commission_total) || 0),
      driver_earnings_total: round2(Number(row.driver_earnings_total) || 0),
      service_commission_total: round2(Number(row.service_commission_total) || 0),
      store_earnings_total: round2(Number(row.store_earnings_total) || 0),
      recent_transactions,
      financial_alerts,
      feature_flags: flags,
    };
  } catch (e) {
    if (isMissingLedgerSchemaError(e)) {
      return { ok: false, reason: "migration_missing", detail: String(e.message || e) };
    }
    throw e;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 */
async function listLedgerWithdrawRequests(sb, userId, opts) {
  const uid = String(userId || "").trim();
  const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 200);
  if (!uid || !sb) return { rows: [], source: "none" };

  const { data, error } = await sb
    .from("withdraw_requests")
    .select("id, user_id, amount, status, created_at, processed_at, note")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!error) {
    return { rows: data || [], source: "withdraw_requests" };
  }

  if (/withdraw_requests|does not exist|schema cache/i.test(String(error.message || ""))) {
    const { data: rows, error: wrErr } = await sb
      .from("ervenow_withdraw_requests")
      .select("id, user_id, amount, status, created_at, processed_at, note, iban")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (wrErr) throw wrErr;
    return { rows: rows || [], source: "ervenow_withdraw_requests" };
  }

  throw error;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {number} amount
 */
async function getWithdrawAvailableBalance(sb, userId, appRole) {
  const ledger = await getLedgerUserWalletSummary(sb, userId, appRole);
  if (!ledger.ok && ledger.reason === "migration_missing") {
    const err = new Error("ervenow_ledger migrations required");
    err.code = "E_LEDGER_MIGRATION";
    throw err;
  }
  return { balance: ledger.ok ? ledger.balance : 0, source: "ervenow_ledger" };
}

/**
 * دين مندوب من ledger (رصيد سالب = مستحق على المندوب).
 */
async function getDriverLedgerOwedBalance(sb, userId) {
  const ledger = await getLedgerUserWalletSummary(sb, userId, "driver");
  const bal = ledger.ok ? Number(ledger.balance) : 0;
  return bal < 0 ? round2(Math.abs(bal)) : 0;
}

/**
 * تحصيل دين — إيداع ledger يقلل الرصيد السالب.
 */
async function collectDriverDebtViaLedger(sb, userId, amount, meta = {}) {
  const amt = round2(Number(amount) || 0);
  if (amt <= 0) return { ok: false, reason: "invalid_amount" };
  const ref =
    String(meta.receipt_reference || meta.receipt_ref || "").trim() ||
    `collect:admin:${Date.now()}:${String(userId).slice(0, 8)}`;
  const { data, error } = await sb.rpc("ervenow_ledger_deposit", {
    p_user_id: userId,
    p_role: "driver",
    p_amount: amt,
    p_reference_id: ref,
    p_description: String(meta.note || "تحصيل عمولة — ledger").slice(0, 500),
  });
  if (error) throw error;
  const row = parseSummaryRow(data);
  return { ...row, receipt_reference: ref };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listDriverDebtsFromLedger(sb, limit = 500) {
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const { data, error } = await sb
    .from("ervenow_ledger_wallets")
    .select("user_id, role, balance, updated_at")
    .eq("role", "driver")
    .not("user_id", "is", null)
    .order("balance", { ascending: true })
    .limit(cap);

  if (error) {
    if (isMissingLedgerSchemaError(error)) return [];
    throw error;
  }

  return (data || []).map((w) => {
    const bal = round2(Number(w.balance) || 0);
    const owed = bal < 0 ? round2(Math.abs(bal)) : 0;
    return {
      driver_id: w.user_id,
      balance: owed,
      ledger_balance: bal,
      updated_at: w.updated_at,
      source: "ervenow_ledger",
    };
  });
}

/**
 * محفظة متجر — ledger فقط (merchant role على users.id).
 */
async function getStoreWalletPayloadWithFallback(sb, userId, _storeId) {
  const ledgerPayload = await getWalletPayloadWithLedgerFallback(sb, userId, "merchant");
  return {
    balance: ledgerPayload.balance,
    total_earned: ledgerPayload.total_earned,
    total_commission: ledgerPayload.total_commission,
    currency_code: "SAR",
    source: "ervenow_ledger",
    wallet_mode: "ledger",
  };
}

/**
 * إيداع لمحفظة تاجر/عميل عبر ledger (بعد دفع متجر مثلاً).
 */
async function ledgerDepositForUser(sb, userId, appRole, amount, referenceId, description) {
  const { data, error } = await sb.rpc("ervenow_ledger_deposit", {
    p_user_id: userId,
    p_role: mapAppRoleToLedgerWalletRole(appRole),
    p_amount: round2(Number(amount) || 0),
    p_reference_id: referenceId,
    p_description: description || "إيداع",
  });
  if (error) throw error;
  return parseSummaryRow(data);
}

module.exports = {
  isMissingLedgerSchemaError,
  aggregateLedgerTransactions,
  listLedgerWalletTransactions,
  computeLedgerWalletFromAllTransactions,
  getWalletMePayload,
  getLedgerUserWalletSummary,
  getWalletPayloadWithLedgerFallback,
  getAdminFinanceSummaryFromLedger,
  computeFinancialAlertsFromLedger,
  listRecentLedgerTransactionsForAdmin,
  listLedgerWithdrawRequests,
  getWithdrawAvailableBalance,
  getStoreWalletPayloadWithFallback,
  getDriverLedgerOwedBalance,
  collectDriverDebtViaLedger,
  listDriverDebtsFromLedger,
  ledgerDepositForUser,
  legacyFinanceDisabledMessage,
  isLedgerOnlyMode,
};
