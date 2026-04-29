const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");

const router = express.Router();
const MIN_WITHDRAW = 20;

/** آيبان سعودي: SA + 22 رقماً (24 حرفاً إجمالاً) */
function isValidIBAN(iban) {
  return /^SA\d{22}$/i.test(iban);
}

/** مندوب، متجر، مقدم خدمة — محفظة سحب ERVENOW (ervenow_wallets) */
const PAYOUT_ROLES = ["driver", "restaurant", "merchant", "service"];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
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

module.exports = router;
