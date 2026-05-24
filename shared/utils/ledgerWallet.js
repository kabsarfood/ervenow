/**
 * قراءة محفظة ervenow_ledger_* — مع fallback للأنظمة القديمة عند غياب بيانات ledger.
 */

const { mapAppRoleToLedgerWalletRole } = require("./ervenowLedgerWallet");
const { getOperationalWalletPayload, listOperationalWalletTransactions, round2 } = require("./operationalWallet");

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
    if (!wallet?.id) return { ok: true, has_data: false, wallet_id: null };

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

/**
 * GET /api/wallet/me — ledger أولاً مع last_transactions، ثم fallback legacy.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {string} appRole
 */
async function getWalletMePayload(sb, userId, appRole) {
  let ledger = await computeLedgerWalletFromAllTransactions(sb, userId, appRole);
  if (!ledger.ok) {
    ledger = await getLedgerUserWalletSummary(sb, userId, appRole);
  }

  if (ledger.ok && ledger.has_data) {
    const last_transactions = await listLedgerWalletTransactions(sb, userId, appRole, 10);
    console.log("[wallet] using ledger");
    return {
      balance: ledger.balance,
      total_earned: ledger.total_earned,
      total_commission: ledger.total_commission,
      last_transactions,
      wallet_mode: "ledger",
      source: "ervenow_ledger",
      wallet_id: ledger.wallet_id || null,
    };
  }

  const legacy = await getOperationalWalletPayload(sb, userId);
  const last_transactions = await listOperationalWalletTransactions(sb, userId, { limit: 10 });
  console.log("[wallet] fallback to legacy");
  return {
    balance: legacy.balance,
    total_earned: legacy.total_earned,
    total_commission: 0,
    total_withdrawn: legacy.total_withdrawn,
    last_transactions,
    wallet_mode: legacy.wallet_mode,
    source: "legacy_operational",
    layer: legacy.layer,
    ledger_fallback_reason: ledger.reason || null,
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
  const ledger = await getLedgerUserWalletSummary(sb, userId, appRole);
  if (ledger.ok && ledger.has_data) {
    return {
      balance: ledger.balance,
      total_earned: ledger.total_earned,
      total_commission: ledger.total_commission,
      wallet_mode: "ledger",
      layer: ledger.layer,
      wallet_id: ledger.wallet_id,
      source: "ervenow_ledger",
    };
  }

  const legacy = await getOperationalWalletPayload(sb, userId);
  return {
    balance: legacy.balance,
    total_earned: legacy.total_earned,
    total_commission: 0,
    total_withdrawn: legacy.total_withdrawn,
    wallet_mode: legacy.wallet_mode,
    layer: legacy.layer,
    source: "legacy_operational",
    ledger_fallback_reason: ledger.reason || null,
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
    const recent_transactions = await listRecentLedgerTransactionsForAdmin(sb, 20);
    return {
      ok: true,
      source: "ervenow_ledger",
      platform_commission_total: round2(Number(row.platform_commission_total) || 0),
      driver_earnings_total: round2(Number(row.driver_earnings_total) || 0),
      service_commission_total: round2(Number(row.service_commission_total) || 0),
      store_earnings_total: round2(Number(row.store_earnings_total) || 0),
      recent_transactions,
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
    const legacy = await sb
      .from("ervenow_withdraw_requests")
      .select("id, user_id, amount, status, created_at, processed_at, note, iban")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (legacy.error) return { rows: [], source: "none" };
    return { rows: legacy.data || [], source: "ervenow_withdraw_requests" };
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
  if (ledger.ok && ledger.has_data) {
    return { balance: ledger.balance, source: "ledger" };
  }
  const legacy = await getOperationalWalletPayload(sb, userId);
  return { balance: legacy.balance, source: "legacy_operational" };
}

/**
 * محفظة متجر — ledger ثم store_wallets.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {string} [storeId]
 */
async function getStoreWalletPayloadWithFallback(sb, userId, storeId) {
  const ledgerPayload = await getWalletPayloadWithLedgerFallback(sb, userId, "merchant");
  if (ledgerPayload.source === "ervenow_ledger") {
    return {
      balance: ledgerPayload.balance,
      total_earned: ledgerPayload.total_earned,
      total_commission: ledgerPayload.total_commission,
      currency_code: "SAR",
      source: "ervenow_ledger",
      wallet_mode: "ledger",
    };
  }

  const sid = String(storeId || "").trim();
  if (sid && sb) {
    try {
      const { data, error } = await sb
        .from("store_wallets")
        .select("balance, currency_code")
        .eq("store_id", sid)
        .maybeSingle();
      if (!error && data) {
        return {
          balance: round2(Number(data.balance) || 0),
          total_earned: round2(Number(data.balance) || 0),
          total_commission: 0,
          currency_code: data.currency_code || "SAR",
          source: "store_wallets",
          wallet_mode: "legacy",
        };
      }
    } catch (_) {
      /* optional */
    }
  }

  return {
    balance: ledgerPayload.balance,
    total_earned: ledgerPayload.total_earned,
    total_commission: ledgerPayload.total_commission,
    currency_code: "SAR",
    source: ledgerPayload.source || "empty",
    wallet_mode: ledgerPayload.wallet_mode || "legacy",
  };
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
  listRecentLedgerTransactionsForAdmin,
  listLedgerWithdrawRequests,
  getWithdrawAvailableBalance,
  getStoreWalletPayloadWithFallback,
};
