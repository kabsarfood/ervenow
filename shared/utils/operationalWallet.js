/**
 * محفظة التشغيل — ervenow_wallets / ervenow_wallet_transactions
 * يعيد أصفاراً عند غياب الجداول أو عدم وجود صف للمستخدم (لا يرمي خطأ).
 */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isMissingWalletSchemaError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /ervenow_wallet|does not exist|schema cache|PGRST205|42P01/i.test(msg);
}

function emptyOperationalWallet(extra) {
  return {
    balance: 0,
    total_earned: 0,
    total_withdrawn: 0,
    wallet_mode: "operational",
    layer: "empty",
    ...(extra || {}),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 */
async function getOperationalWalletPayload(sb, userId) {
  const uid = String(userId || "").trim();
  if (!uid) return emptyOperationalWallet({ reason: "missing_user_id" });

  try {
    const { data: rpcData, error: rpcErr } = await sb.rpc("ervenow_wallet_operational_summary", {
      p_user_id: uid,
    });
    if (!rpcErr && rpcData && typeof rpcData === "object" && !Array.isArray(rpcData)) {
      const b = Number(rpcData.balance);
      const te = Number(rpcData.total_earned);
      const tw = Number(rpcData.total_withdrawn);
      return {
        balance: round2(Number.isFinite(b) ? b : 0),
        total_earned: round2(Number.isFinite(te) ? te : 0),
        total_withdrawn: round2(Number.isFinite(tw) ? tw : 0),
        wallet_mode: "operational",
        layer: "ervenow_wallet_transactions",
      };
    }
  } catch (e) {
    if (!isMissingWalletSchemaError(e)) {
      console.warn("[operationalWallet] rpc summary:", e.message || e);
    }
  }

  try {
    const { data, error } = await sb
      .from("ervenow_wallets")
      .select("balance, total_earned, total_withdrawn, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) {
      if (isMissingWalletSchemaError(error)) return emptyOperationalWallet();
      throw error;
    }
    if (!data) return emptyOperationalWallet({ layer: "ervenow_wallets", note: "no_wallet_row" });
    return {
      balance: round2(Number(data.balance) || 0),
      total_earned: round2(Number(data.total_earned) || 0),
      total_withdrawn: round2(Number(data.total_withdrawn) || 0),
      wallet_mode: "operational",
      layer: "ervenow_wallets",
    };
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return emptyOperationalWallet();
    throw e;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 */
async function listOperationalWalletTransactions(sb, userId, opts) {
  const uid = String(userId || "").trim();
  const limit = Math.min(Math.max(Number(opts?.limit) || 100, 1), 200);
  if (!uid) return [];

  const { data, error } = await sb
    .from("ervenow_wallet_transactions")
    .select("id, amount, type, status, reference_id, note, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingWalletSchemaError(error)) return [];
    throw error;
  }
  return data || [];
}

module.exports = {
  round2,
  isMissingWalletSchemaError,
  emptyOperationalWallet,
  getOperationalWalletPayload,
  listOperationalWalletTransactions,
};
