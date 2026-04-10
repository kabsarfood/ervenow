function walletOwnerTypeForRole(role) {
  if (role === "driver") return "driver";
  if (role === "merchant" || role === "restaurant") return "merchant";
  if (role === "service") return "service";
  if (role === "customer") return "customer";
  return "customer";
}

async function ensureWallet(supabase, ownerId, ownerType, countryCode = "SAR", currencyCode = "SAR") {
  const { data, error } = await supabase.rpc("erwenow_fn_ensure_wallet", {
    p_owner_id: ownerId,
    p_owner_type: ownerType,
    p_country: countryCode,
    p_currency: currencyCode,
  });
  if (error) throw error;
  return data;
}

async function getWalletByOwner(supabase, ownerId, ownerType, countryCode = "SA") {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("owner_type", ownerType)
    .eq("country_code", countryCode)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getOrCreateWalletForUser(supabase, userId, role, countryCode = "SA", currencyCode = "SAR") {
  const ownerType = walletOwnerTypeForRole(role);
  let w = await getWalletByOwner(supabase, userId, ownerType, countryCode);
  if (!w) {
    const id = await ensureWallet(supabase, userId, ownerType, countryCode, currencyCode);
    const { data, error } = await supabase.from("wallets").select("*").eq("id", id).single();
    if (error) throw error;
    w = data;
  }
  return w;
}

async function listTransactions(supabase, walletId, limit = 50) {
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("*")
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function createWithdrawalRequest(supabase, walletId, amount, bankNote) {
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    const e = new Error("amount invalid");
    e.status = 400;
    throw e;
  }

  const { data: w, error: we } = await supabase.from("wallets").select("balance").eq("id", walletId).single();
  if (we) throw we;
  if (Number(w.balance) < amt) {
    const e = new Error("INSUFFICIENT_FUNDS");
    e.status = 400;
    throw e;
  }

  const { data, error } = await supabase
    .from("withdrawals")
    .insert({
      wallet_id: walletId,
      amount: amt,
      status: "pending",
      bank_note: bankNote || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** اعتماد سحب: خصم من المحفظة عبر حركة debit */
async function approveWithdrawal(supabase, withdrawalId) {
  const { data: row, error: ge } = await supabase.from("withdrawals").select("*").eq("id", withdrawalId).single();
  if (ge) throw ge;
  if (!row || row.status !== "pending") {
    const e = new Error("WITHDRAWAL_NOT_PENDING");
    e.status = 400;
    throw e;
  }

  const { error: te } = await supabase.from("wallet_transactions").insert({
    wallet_id: row.wallet_id,
    type: "debit",
    amount: row.amount,
    description: "سحب — اعتماد",
    reference_id: withdrawalId,
    metadata: { kind: "withdrawal_approve" },
  });
  if (te) throw te;

  const { data, error } = await supabase
    .from("withdrawals")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", withdrawalId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function markWithdrawalPaid(supabase, withdrawalId) {
  const { data, error } = await supabase
    .from("withdrawals")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", withdrawalId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function rejectWithdrawal(supabase, withdrawalId) {
  const { data: row, error: ge } = await supabase.from("withdrawals").select("*").eq("id", withdrawalId).single();
  if (ge) throw ge;
  if (!row || row.status !== "pending") {
    const e = new Error("WITHDRAWAL_NOT_PENDING");
    e.status = 400;
    throw e;
  }

  const { data, error } = await supabase
    .from("withdrawals")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", withdrawalId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  walletOwnerTypeForRole,
  ensureWallet,
  getWalletByOwner,
  getOrCreateWalletForUser,
  listTransactions,
  createWithdrawalRequest,
  approveWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
};
