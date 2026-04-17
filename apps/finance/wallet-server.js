const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

const walletService = require("./walletService");
const { createServiceClient } = require("../../shared/config/supabase");

function supabaseOrThrow() {
  const sb = createServiceClient();
  if (!sb) {
    const e = new Error("SUPABASE_SERVICE_ROLE_KEY is required for wallet-server");
    e.status = 500;
    throw e;
  }
  return sb;
}

async function resolveUserRole(supabase, userId) {
  const { data, error } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data || data.role == null) {
    const e = new Error("USER_NOT_FOUND");
    e.status = 404;
    throw e;
  }
  return data.role;
}

async function withdrawalAggregates(supabase, walletId) {
  const { data: pend, error: e1 } = await supabase
    .from("withdrawals")
    .select("amount")
    .eq("wallet_id", walletId)
    .eq("status", "pending");
  if (e1) throw e1;
  const pending = (pend || []).reduce((s, r) => s + Number(r.amount || 0), 0);

  const { data: paid, error: e2 } = await supabase
    .from("withdrawals")
    .select("amount")
    .eq("wallet_id", walletId)
    .eq("status", "paid");
  if (e2) throw e2;
  const withdrawn = (paid || []).reduce((s, r) => s + Number(r.amount || 0), 0);

  return { pending, withdrawn };
}

app.get("/api/wallet/:userId", async (req, res) => {
  try {
    const supabase = supabaseOrThrow();
    const userId = req.params.userId;
    const role = await resolveUserRole(supabase, userId);
    const wallet = await walletService.getOrCreateWalletForUser(supabase, userId, role);
    const { pending, withdrawn } = await withdrawalAggregates(supabase, wallet.id);
    res.json({
      balance: Number(wallet.balance),
      pending,
      withdrawn,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

app.get("/api/wallet/transactions/:userId", async (req, res) => {
  try {
    const supabase = supabaseOrThrow();
    const userId = req.params.userId;
    const role = await resolveUserRole(supabase, userId);
    const wallet = await walletService.getOrCreateWalletForUser(supabase, userId, role);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const wallet_transactions = await walletService.listTransactions(supabase, wallet.id, limit);
    res.json({ wallet_transactions });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

app.post("/api/wallet/withdraw", async (req, res) => {
  try {
    const supabase = supabaseOrThrow();
    const { userId, amount, bank_note } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    const role = await resolveUserRole(supabase, userId);
    const wallet = await walletService.getOrCreateWalletForUser(supabase, userId, role);
    const row = await walletService.createWithdrawalRequest(supabase, wallet.id, amount, bank_note || null);
    res.status(201).json(row);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

const PORT = 9000;

app.listen(PORT, () => {
  console.log("\u{1F525} WALLET API RUNNING ON 9000");
});
