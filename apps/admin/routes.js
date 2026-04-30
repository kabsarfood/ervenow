const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { getRiyadhDate } = require("../delivery/service");

const router = express.Router();

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isStoresTableMissing(err) {
  if (!err) return false;
  if (String(err.code || "") === "42P01") return true;
  const msg = String(err.message || err.details || "");
  return /public\.stores|schema cache|relation .*stores/i.test(msg);
}

router.get("/daily-report", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const iso = start.toISOString();
    const todayRiyadh = getRiyadhDate();

    const { data, error } = await req.supabase
      .from("orders")
      .select("platform_fee, driver_earning, delivery_fee, total_with_vat")
      .gte("created_at", iso);

    if (error) return fail(res, error.message, 400);
    const rows = data || [];
    const totalOrders = rows.length;
    let totalPlatform = 0;
    let totalDrivers = 0;
    for (const r of rows) {
      totalPlatform += Number(r.platform_fee) || 0;
      const de = Number(r.driver_earning);
      const df = Number(r.delivery_fee);
      totalDrivers += de > 0 ? de : df > 0 ? df : 0;
    }

    const totalRevenue = rows.reduce((a, b) => a + (Number(b.total_with_vat) || 0), 0);

    const { data: vatData, error: vatErr } = await req.supabase
      .from("vat_records")
      .select("vat_amount")
      .eq("vat_date_riyadh", todayRiyadh);

    if (vatErr) return fail(res, vatErr.message, 400);
    const totalVAT = (vatData || []).reduce((a, b) => a + (Number(b.vat_amount) || 0), 0);

    ok(res, {
      date: todayRiyadh,
      totalOrders,
      totalPlatform: round2(totalPlatform),
      totalDrivers: round2(totalDrivers),
      totalVAT: round2(totalVAT),
      totalRevenue: round2(totalRevenue),
    });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/withdraws", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("ervenow_withdraw_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return fail(res, error.message, 400);
    ok(res, { requests: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/withdraws/:id/approve", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const { data: reqRow, error: gErr } = await req.supabase.from("ervenow_withdraw_requests").select("*").eq("id", id).single();
    if (gErr || !reqRow) return fail(res, "Not found", 404);
    if (reqRow.status !== "pending") {
      return fail(res, "الطلب ليس قيد المراجعة", 400);
    }

    const uid = reqRow.user_id;
    const amount = Number(reqRow.amount);
    if (!(amount > 0)) return fail(res, "مبلغ غير صالح", 400);

    const { data: w } = await req.supabase.from("ervenow_wallets").select("*").eq("user_id", uid).maybeSingle();
    const bal = Number(w?.balance) || 0;
    if (amount > bal) {
      return fail(res, "رصيد المستخدم أقل من المبلغ", 400);
    }

    const newBal = round2(bal - amount);
    const tw = round2(Number(w?.total_withdrawn) || 0) + amount;

    const { error: uW } = await req.supabase
      .from("ervenow_wallets")
      .update({
        balance: newBal,
        total_withdrawn: tw,
      })
      .eq("user_id", uid);
    if (uW) return fail(res, uW.message, 400);

    const { error: txE } = await req.supabase.from("ervenow_wallet_transactions").insert({
      user_id: uid,
      amount,
      type: "withdraw",
      reference_id: id,
      note: "سحب (موافقة إدارية)",
    });
    if (txE) return fail(res, txE.message, 400);

    const { error: uR } = await req.supabase
      .from("ervenow_withdraw_requests")
      .update({ status: "approved", processed_at: new Date().toISOString(), note: (reqRow.note || "") + " | OK" })
      .eq("id", id);
    if (uR) return fail(res, uR.message, 400);

    ok(res, { ok: true });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/store-requests", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const statusQ = String(req.query.status || "").trim().toLowerCase();
    let q = req.supabase.from("stores").select("*").order("created_at", { ascending: false }).limit(300);
    if (statusQ) q = q.eq("status", statusQ);
    const { data, error } = await q;
    if (error) {
      if (isStoresTableMissing(error)) {
        return fail(res, "جدول stores غير موجود. نفّذ migration_stores.sql أولاً.", 400);
      }
      return fail(res, error.message, 400);
    }
    return ok(res, { requests: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.patch("/store-requests/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "";
    if (!status) return fail(res, "action must be approve or reject", 400);

    const { data, error } = await req.supabase
      .from("stores")
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      if (isStoresTableMissing(error)) {
        return fail(res, "جدول stores غير موجود. نفّذ migration_stores.sql أولاً.", 400);
      }
      return fail(res, error.message, 400);
    }
    return ok(res, { request: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/drivers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return fail(res, error.message, 400);
    return ok(res, { drivers: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/approve-driver", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "approved", active: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/reject-driver", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "rejected", active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/block-driver", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "blocked", active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/stats", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const iso = start.toISOString();

    const { data: orders, error: oErr } = await req.supabase
      .from("orders")
      .select("id, created_at, delivery_status, order_total, platform_fee, driver_earning");
    if (oErr) return fail(res, oErr.message, 400);
    const { data: services, error: sErr } = await req.supabase
      .from("service_bookings")
      .select("id, created_at, status, total_amount, platform_commission");
    if (sErr) return fail(res, sErr.message, 400);

    const allOrders = orders || [];
    const allServices = services || [];
    const totalOrders = allOrders.length + allServices.length;
    const todayOrders =
      allOrders.filter((x) => x.created_at >= iso).length +
      allServices.filter((x) => x.created_at >= iso).length;
    const activeOrders =
      allOrders.filter((x) => ["new", "pending", "accepted", "delivering"].includes(x.delivery_status || x.status))
        .length +
      allServices.filter((x) => ["new", "accepted", "delivering"].includes(x.status)).length;

    const revenueOrders = allOrders.reduce((a, b) => a + (Number(b.order_total) || 0), 0);
    const revenueServices = allServices.reduce((a, b) => a + (Number(b.total_amount) || 0), 0);
    const platformOrders = allOrders.reduce((a, b) => a + (Number(b.platform_fee) || 0), 0);
    const platformServices = allServices.reduce((a, b) => a + (Number(b.platform_commission) || 0), 0);
    const driversEarnings = allOrders.reduce((a, b) => a + (Number(b.driver_earning) || 0), 0);

    return ok(res, {
      total_orders: totalOrders,
      today_orders: todayOrders,
      active_orders: activeOrders,
      total_revenue: round2(revenueOrders + revenueServices),
      platform_commission: round2(platformOrders + platformServices),
      drivers_earnings: round2(driversEarnings),
    });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/complaints", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("complaints")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return fail(res, error.message, 400);
    return ok(res, { complaints: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/resolve-complaint", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("complaints")
      .update({ status: "resolved" })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { complaint: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/providers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { data: users, error: uErr } = await req.supabase
      .from("users")
      .select("id, phone, role, created_at")
      .in("role", ["restaurant", "merchant", "service"])
      .order("created_at", { ascending: false })
      .limit(500);
    if (uErr) return fail(res, uErr.message, 400);

    let stores = [];
    const { data: sData, error: sErr } = await req.supabase
      .from("stores")
      .select("id, name, phone, type, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!sErr) stores = sData || [];

    return ok(res, { providers: users || [], stores });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
