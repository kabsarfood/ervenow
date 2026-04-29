const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const {
  fetchCommissionRates,
  calculateCommission,
  distributeFunds,
  handleRefund,
} = require("./accountingEngine");
const {
  getOrCreateWalletForUser,
  listTransactions,
  createWithdrawalRequest,
  approveWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
} = require("./walletService");

const router = express.Router();

router.get("/health", (_req, res) => {
  return ok(res, {
    service: "finance",
    engine: ["calculateCommission", "distributeFunds", "handleRefund"],
  });
});

function canReadFinanceOrder(order, u) {
  if (!order) return false;
  if (u.role === "admin") return true;
  if (order.customer_id === u.id) return true;
  if (order.merchant_id === u.id) return true;
  if (order.driver_id === u.id) return true;
  if (order.service_provider_id === u.id) return true;
  return false;
}

/** POST /orders — إنشاء طلب مالي */
router.post("/orders", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const customerId =
      req.appUser.role === "admin" && body.customer_id ? body.customer_id : req.appUser.id;

    const row = {
      customer_id: customerId,
      merchant_id: body.merchant_id || null,
      driver_id: body.driver_id || null,
      service_provider_id: body.service_provider_id || null,
      delivery_order_id: body.delivery_order_id || null,
      external_order_id: body.external_order_id || null,
      series_source: body.series_source || "ervenow",
      country_code: body.country_code || "SA",
      city: body.city || null,
      currency_code: body.currency_code || "SAR",
      total_amount: Number(body.total_amount) || 0,
      delivery_fee: Number(body.delivery_fee) || 0,
      status: body.status && String(body.status) === "accepted" ? "accepted" : "new",
      delivery_status: "pending",
      breakdown: {},
    };

    const { data, error } = await req.supabase.from("orders").insert(row).select().single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** GET /orders */
router.get("/orders", requireAuth, async (req, res) => {
  try {
    let q = req.supabase.from("orders").select("*").order("created_at", { ascending: false });

    if (req.appUser.role === "admin") {
      /* no filter */
    } else if (req.appUser.role === "customer") {
      q = q.eq("customer_id", req.appUser.id);
    } else if (req.appUser.role === "merchant" || req.appUser.role === "restaurant") {
      q = q.eq("merchant_id", req.appUser.id);
    } else if (req.appUser.role === "driver") {
      q = q.eq("driver_id", req.appUser.id);
    } else if (req.appUser.role === "service") {
      q = q.eq("service_provider_id", req.appUser.id);
    } else {
      return ok(res, { orders: [] });
    }

    const { data, error } = await q.limit(200);
    if (error) return fail(res, error.message, 400);
    return ok(res, { orders: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** GET /orders/:id */
router.get("/orders/:id", requireAuth, async (req, res) => {
  try {
    const { data: order, error } = await req.supabase.from("orders").select("*").eq("id", req.params.id).single();
    if (error || !order) return fail(res, "Not found", 404);
    if (!canReadFinanceOrder(order, req.appUser)) return fail(res, "Forbidden", 403);
    return ok(res, { order });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** PATCH /orders/:id/status — تحديث الحالة؛ عند delivered يُشغَّل المحاسب الخفي */
router.patch("/orders/:id/status", requireAuth, async (req, res) => {
  try {
    const next = String(req.body?.status || "").trim();
    if (!next) return fail(res, "status required", 400);

    const { data: order, error: ge } = await req.supabase.from("orders").select("*").eq("id", req.params.id).single();
    if (ge || !order) return fail(res, "Not found", 404);

    const u = req.appUser;
    const allowed =
      u.role === "admin" ||
      (u.role === "customer" && order.customer_id === u.id && next === "cancelled") ||
      (u.role === "driver" && order.driver_id === u.id && ["onroad", "delivered"].includes(next)) ||
      (["merchant", "restaurant"].includes(u.role) && order.merchant_id === u.id && next === "accepted");

    if (!allowed) return fail(res, "Forbidden", 403);

    if (next === "cancelled") {
      if (["delivered", "cancelled"].includes(order.status)) {
        return fail(res, "Cannot cancel this order", 400);
      }
      const { data, error } = await req.supabase
        .from("orders")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", order.id)
        .select()
        .single();
      if (error) return fail(res, error.message, 400);
      return ok(res, { order: data });
    }

    if (next === "delivered") {
      if (order.settled_at) return fail(res, "Already settled", 400);
      const rates = await fetchCommissionRates(req.supabase, order.country_code || "SA");
      const vat = Number(
        process.env.ERVENOW_PLATFORM_VAT_ON_COMMISSION_RATE ||
          process.env.ERWENOW_PLATFORM_VAT_ON_COMMISSION_RATE ||
          0
      );
      const calc = calculateCommission({
        orderTotal: Number(order.total_amount),
        deliveryFee: Number(order.delivery_fee),
        rateMerchant: rates.merchant,
        rateDelivery: rates.delivery,
        merchantId: order.merchant_id,
        serviceProviderId: order.service_provider_id,
        platformVatOnCommissionRate: vat,
      });

      const driverId = req.body.driver_id || order.driver_id;
      const { data: updated, error: ue } = await req.supabase
        .from("orders")
        .update({
          status: "delivered",
          breakdown: calc.breakdown,
          driver_id: driverId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .select()
        .single();

      if (ue) return fail(res, ue.message, 400);

      let settlement;
      try {
        settlement = await distributeFunds(req.supabase, order.id);
      } catch (rpcErr) {
        return fail(res, rpcErr.message || "Settlement failed", 500);
      }

      return ok(res, { order: updated, settlement, commission: calc.breakdown });
    }

    const { data, error } = await req.supabase
      .from("orders")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .select()
      .single();

    if (error) return fail(res, error.message, 400);
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** POST /orders/:id/refund — بعد إلغاء الطلب */
router.post("/orders/:id/refund", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data: order, error: ge } = await req.supabase.from("orders").select("*").eq("id", req.params.id).single();
    if (ge || !order) return fail(res, "Not found", 404);
    if (order.status !== "cancelled") return fail(res, "Order must be cancelled first", 400);

    const body = req.body || {};
    const defaultAmt = Number(order.total_amount) + Number(order.delivery_fee);
    const customerCredit = body.amount != null ? Number(body.amount) : defaultAmt;

    let result;
    try {
      result = await handleRefund(req.supabase, order.id, body.reason || "استرجاع إداري", customerCredit);
    } catch (rpcErr) {
      return fail(res, rpcErr.message || "Refund failed", 500);
    }

    if (result && result.already_refunded) {
      return ok(res, { refund: result, amount: customerCredit, skipped: true });
    }

    await req.supabase.from("refunds").insert({
      order_id: order.id,
      amount: customerCredit,
      reason: body.reason || null,
      status: result && result.ok === false ? "failed" : "completed",
    });

    return ok(res, { refund: result, amount: customerCredit });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** GET /commission-rules */
router.get("/commission-rules", requireAuth, async (req, res) => {
  try {
    const cc = req.query.country || "SA";
    const { data, error } = await req.supabase
      .from("commission_rules")
      .select("*")
      .eq("is_active", true)
      .or(`country_code.eq.${cc},country_code.is.null`);

    if (error) return fail(res, error.message, 400);
    return ok(res, { rules: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** POST /commission-rules — إدارة */
router.post("/commission-rules", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      commission_rate: Number(body.commission_rate),
      applies_to: body.applies_to,
      country_code: body.country_code || "SA",
      is_active: body.is_active !== false,
    };
    if (!(row.commission_rate >= 0 && row.commission_rate <= 1)) return fail(res, "commission_rate invalid", 400);
    if (!["merchant", "delivery", "service"].includes(row.applies_to)) return fail(res, "applies_to invalid", 400);

    const { data, error } = await req.supabase.from("commission_rules").insert(row).select().single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { rule: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** GET /wallet/me */
router.get("/wallet/me", requireAuth, async (req, res) => {
  try {
    const cc = req.query.country || "SA";
    const wallet = await getOrCreateWalletForUser(req.supabase, req.appUser.id, req.appUser.role, cc);
    return ok(res, { wallet });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** GET /wallet/transactions */
router.get("/wallet/transactions", requireAuth, async (req, res) => {
  try {
    const cc = req.query.country || "SA";
    const wallet = await getOrCreateWalletForUser(req.supabase, req.appUser.id, req.appUser.role, cc);
    const txs = await listTransactions(req.supabase, wallet.id, Number(req.query.limit) || 50);
    return ok(res, { wallet_id: wallet.id, transactions: txs });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** POST /withdrawals */
router.post("/withdrawals", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const cc = req.query.country || "SA";
    const wallet = await getOrCreateWalletForUser(req.supabase, req.appUser.id, req.appUser.role, cc);
    const row = await createWithdrawalRequest(req.supabase, wallet.id, body.amount, body.bank_note);
    return ok(res, { withdrawal: row });
  } catch (e) {
    const st = e.status || 500;
    return fail(res, e.message || String(e), st);
  }
});

/** PATCH /withdrawals/:id — admin */
router.patch("/withdrawals/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim();
    if (action === "approve") {
      const row = await approveWithdrawal(req.supabase, req.params.id);
      return ok(res, { withdrawal: row });
    }
    if (action === "paid") {
      const row = await markWithdrawalPaid(req.supabase, req.params.id);
      return ok(res, { withdrawal: row });
    }
    if (action === "reject") {
      const row = await rejectWithdrawal(req.supabase, req.params.id);
      return ok(res, { withdrawal: row });
    }
    return fail(res, "action must be approve | paid | reject", 400);
  } catch (e) {
    const st = e.status || 500;
    return fail(res, e.message || String(e), st);
  }
});

/** POST /preview-commission — معاينة بدون حفظ */
router.post("/preview-commission", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const cc = body.country_code || "SA";
    const rates = await fetchCommissionRates(req.supabase, cc);
    const vat = Number(
      process.env.ERVENOW_PLATFORM_VAT_ON_COMMISSION_RATE ||
        process.env.ERWENOW_PLATFORM_VAT_ON_COMMISSION_RATE ||
        0
    );
    const calc = calculateCommission({
      orderTotal: Number(body.total_amount) || 0,
      deliveryFee: Number(body.delivery_fee) || 0,
      rateMerchant: rates.merchant,
      rateDelivery: rates.delivery,
      merchantId: body.merchant_id || null,
      serviceProviderId: body.service_provider_id || null,
      platformVatOnCommissionRate: vat,
    });
    return ok(res, { commission: calc.breakdown });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
