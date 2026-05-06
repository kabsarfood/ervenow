const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { driverApprovedBody } = require("../../shared/messages/driverWhatsApp");
const { getRiyadhDate } = require("../delivery/service");
const { readState, writeState } = require("../../shared/utils/siteMaintenanceStore");

const router = express.Router();

const ADMIN_PERMISSIONS = {
  full: [
    "dashboard",
    "drivers",
    "customers",
    "complaints",
    "stores",
    "jobs",
    "finance",
    "providers",
    "notifications",
    "orders",
    "admin_accounts",
  ],
  limited1: ["dashboard", "drivers", "complaints", "notifications", "orders"],
  limited2: ["dashboard", "customers", "stores", "jobs", "orders"],
};

function normalizeDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function parsePhoneList(envValue) {
  return String(envValue || "")
    .split(",")
    .map((x) => {
      const raw = String(x || "").trim();
      if (!raw) return "";
      if (/^05\d{8}$/.test(raw)) return "966" + raw.slice(1);
      const d = normalizeDigits(raw);
      if (d.startsWith("5") && d.length === 9) return "966" + d;
      return d;
    })
    .filter(Boolean);
}

function getAdminProfileByPhone(phoneRaw) {
  const phone = normalizeDigits(phoneRaw);
  const fullPhones = parsePhoneList(process.env.ERVENOW_ADMIN_FULL_PHONES || "0505745650");
  const limited1Phones = parsePhoneList(process.env.ERVENOW_ADMIN_LIMITED1_PHONES);
  const limited2Phones = parsePhoneList(process.env.ERVENOW_ADMIN_LIMITED2_PHONES);

  let level = "full";
  if (limited1Phones.includes(phone)) level = "limited1";
  if (limited2Phones.includes(phone)) level = "limited2";
  if (fullPhones.length && fullPhones.includes(phone)) level = "full";

  const permissions = ADMIN_PERMISSIONS[level] || ADMIN_PERMISSIONS.full;
  return { level, permissions };
}

function getAdminSlots() {
  const fullPhones = parsePhoneList(process.env.ERVENOW_ADMIN_FULL_PHONES || "0505745650");
  const limited1Phones = parsePhoneList(process.env.ERVENOW_ADMIN_LIMITED1_PHONES);
  const limited2Phones = parsePhoneList(process.env.ERVENOW_ADMIN_LIMITED2_PHONES);
  return {
    full: fullPhones[0] || null,
    limited1: limited1Phones[0] || null,
    limited2: limited2Phones[0] || null,
  };
}

function requireAdminPermission(permission) {
  return (req, res, next) => {
    const profile = getAdminProfileByPhone(req.appUser?.phone);
    if (!profile.permissions.includes(permission)) {
      return fail(res, "صلاحيات الأدمن لا تسمح بهذه العملية", 403, {
        permission,
        level: profile.level,
      });
    }
    req.adminProfile = profile;
    next();
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function amountFromRow(row) {
  const amount = row && row.total_amount != null ? row.total_amount : row && row.total != null ? row.total : 0;
  return Number(amount) || 0;
}

function isCancelledOrder(row) {
  const s = String(row?.delivery_status || row?.status || "").toLowerCase();
  return s === "cancelled" || s === "cancelled_by_customer" || s === "canceled" || s === "canceled_by_customer";
}

/** مبلغ الفاتورة للعرض والإيراد: total_with_vat أولاً (طلبات توصيل)، ثم تجميع، ثم total_amount / order_total */
function orderBillableAmount(row) {
  if (!row || typeof row !== "object") return 0;
  const twv = Number(row.total_with_vat);
  if (Number.isFinite(twv) && twv > 0) return Math.round(twv * 100) / 100;
  const ot = Number(row.order_total) || 0;
  const df = Number(row.delivery_fee) || 0;
  const vat = Number(row.vat_amount) || 0;
  const composed = ot + df + vat;
  if (Number.isFinite(composed) && composed > 0) return Math.round(composed * 100) / 100;
  const ta = Number(row.total_amount);
  if (Number.isFinite(ta) && ta > 0) return Math.round(ta * 100) / 100;
  if (Number.isFinite(ot) && ot > 0) return Math.round(ot * 100) / 100;
  return 0;
}

function isStoresTableMissing(err) {
  if (!err) return false;
  if (String(err.code || "") === "42P01") return true;
  const msg = String(err.message || err.details || "");
  return /public\.stores|schema cache|relation .*stores/i.test(msg);
}

async function linkStoreOwnerAfterApprove(sb, store) {
  try {
    const phoneDigits = String(store.phone || "").replace(/\D/g, "");
    if (!phoneDigits || !store?.id) return;
    const { data: u, error } = await sb.from("users").select("id, role").eq("phone", phoneDigits).maybeSingle();
    if (error || !u?.id) return;
    const patch = { updated_at: new Date().toISOString() };
    patch.owner_user_id = u.id;
    const up = await sb.from("stores").update(patch).eq("id", store.id);
    if (up.error && /owner_user_id|column/i.test(String(up.error.message || ""))) {
      console.warn("[admin/linkStoreOwner] owner_user_id missing — migration_store_marketplace.sql");
      return;
    }
    const r = String(u.role || "").toLowerCase();
    if (!["merchant", "restaurant", "admin"].includes(r)) {
      await sb.from("users").update({ role: "merchant", updated_at: new Date().toISOString() }).eq("id", u.id);
    }
  } catch (e) {
    console.warn("[admin/linkStoreOwner]", e && (e.message || e));
  }
}

async function updateStoreWithOptionalActive(sb, id, patch) {
  const p = { ...patch };
  let { data, error } = await sb.from("stores").update(p).eq("id", id).select("*").single();
  if (error && /is_active|column|schema cache/i.test(String(error.message || ""))) {
    delete p.is_active;
    ({ data, error } = await sb.from("stores").update(p).eq("id", id).select("*").single());
  }
  return { data, error };
}

function isSchemaMissingError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  if (code === "42P01" || code === "PGRST204") return true;
  const msg = String(err.message || err.details || "");
  return /Could not find the|schema cache|relation .* does not exist|column .* does not exist/i.test(msg);
}

function parseDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function resolveRangeWindow(rangeRaw) {
  const range = String(rangeRaw || "today").toLowerCase();
  const now = new Date();
  if (range === "week") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    return { range: "week", start, unit: "day" };
  }
  if (range === "month") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 29);
    return { range: "month", start, unit: "day" };
  }
  return { range: "today", start: startOfToday(), unit: "hour" };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildChartForRange(rows, rangeMeta) {
  const counts = Object.create(null);
  const labels = [];
  const values = [];

  if (rangeMeta.unit === "hour") {
    for (let h = 0; h < 24; h += 1) {
      const key = pad2(h);
      labels.push(key + ":00");
      counts[key] = 0;
    }
    for (const r of rows) {
      const dt = parseDateSafe(r?.created_at);
      if (!dt) continue;
      if (dt < rangeMeta.start) continue;
      const key = pad2(dt.getHours());
      if (counts[key] == null) counts[key] = 0;
      counts[key] += 1;
    }
    for (let h = 0; h < 24; h += 1) {
      values.push(counts[pad2(h)] || 0);
    }
    return { labels, values };
  }

  const days = rangeMeta.range === "week" ? 7 : 30;
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key.slice(5));
    counts[key] = 0;
  }
  for (const r of rows) {
    const dt = parseDateSafe(r?.created_at);
    if (!dt) continue;
    if (dt < rangeMeta.start) continue;
    const key = dt.toISOString().slice(0, 10);
    if (counts[key] == null) counts[key] = 0;
    counts[key] += 1;
  }
  for (const k of Object.keys(counts)) {
    values.push(counts[k] || 0);
  }
  return { labels, values };
}

async function safeSelectRows(sb, tableName, selectExpr) {
  const { data, error } = await sb.from(tableName).select(selectExpr);
  if (error) {
    if (isSchemaMissingError(error)) {
      console.warn("[admin/safeSelectRows] schema fallback:", tableName, error.message || error);
      return [];
    }
    throw error;
  }
  return data || [];
}

async function safeSelectRowsWithFallback(sb, tableName, selectExprList) {
  let lastErr = null;
  for (const expr of selectExprList) {
    const { data, error } = await sb.from(tableName).select(expr);
    if (!error) return data || [];
    if (isSchemaMissingError(error)) {
      lastErr = error;
      continue;
    }
    throw error;
  }
  if (lastErr) {
    console.warn("[admin/safeSelectRowsWithFallback] schema fallback:", tableName, lastErr.message || lastErr);
  }
  return [];
}

function isEmployeeApplicationsTableMissing(err) {
  if (!err) return false;
  if (String(err.code || "") === "42P01") return true;
  const msg = String(err.message || err.details || "");
  return /employee_applications|relation .*employee_applications/i.test(msg);
}

async function syncUserRoleByPhone(sb, phone, role) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits || !role) return;
  const { error } = await sb
    .from("users")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("phone", digits);
  if (error) throw error;
}

async function syncUserStatusByPhone(sb, phone, status) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits || !status) return;
  const first = await sb
    .from("users")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("phone", digits);
  if (!first.error) return;
  if (isSchemaMissingError(first.error)) {
    // backward compatibility before users.status migration
    if (status === "blocked") {
      const fbBlock = await sb
        .from("users")
        .update({ role: "blocked", updated_at: new Date().toISOString() })
        .eq("phone", digits);
      if (fbBlock.error) throw fbBlock.error;
      return;
    }
    if (status === "active") {
      const fbActive = await sb
        .from("users")
        .update({ role: "customer", updated_at: new Date().toISOString() })
        .eq("phone", digits);
      if (fbActive.error) throw fbActive.error;
      return;
    }
  }
  throw first.error;
}

router.get("/site-maintenance", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (_req, res) => {
  try {
    return ok(res, { enabled: readState() });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/site-maintenance", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    writeState(enabled);
    return ok(res, { enabled: readState() });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/me", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const p = getAdminProfileByPhone(req.appUser?.phone);
    return ok(res, {
      phone: req.appUser?.phone || null,
      level: p.level,
      permissions: p.permissions,
    });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/admin-accounts", requireAuth, requireRole("admin"), requireAdminPermission("admin_accounts"), async (req, res) => {
  try {
    const slots = getAdminSlots();
    const phones = Object.values(slots).filter(Boolean);
    let users = [];
    if (phones.length) {
      const { data, error } = await req.supabase
        .from("users")
        .select("id, phone, role, status, updated_at")
        .in("phone", phones);
      if (error) return fail(res, error.message, 400);
      users = data || [];
    }
    const map = Object.create(null);
    users.forEach((u) => {
      map[String(u.phone || "")] = u;
    });
    const out = ["full", "limited1", "limited2"].map((slot) => {
      const phone = slots[slot] || null;
      const user = phone ? map[phone] || null : null;
      return {
        slot,
        phone,
        user_id: user ? user.id : null,
        role: user ? user.role : null,
        status: user ? user.status || "active" : "missing",
      };
    });
    return ok(res, { admins: out });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post(
  "/admin-accounts/:slot/action",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("admin_accounts"),
  async (req, res) => {
    try {
      const slot = String(req.params.slot || "").trim().toLowerCase();
      const action = String(req.body?.action || "").trim().toLowerCase();
      if (!["limited1", "limited2"].includes(slot)) {
        return fail(res, "يمكن إدارة أدمن 1 وأدمن 2 فقط", 400);
      }
      if (!["logout", "block", "activate"].includes(action)) {
        return fail(res, "action must be logout/block/activate", 400);
      }

      const slots = getAdminSlots();
      const phone = slots[slot];
      if (!phone) return fail(res, "رقم الأدمن غير مضبوط في الإعدادات", 400);

      let patch = {};
      if (action === "logout") patch = { role: "user", status: "active", updated_at: new Date().toISOString() };
      if (action === "block") patch = { status: "blocked", updated_at: new Date().toISOString() };
      if (action === "activate") patch = { role: "admin", status: "active", updated_at: new Date().toISOString() };

      const { data, error } = await req.supabase
        .from("users")
        .update(patch)
        .eq("phone", phone)
        .select("id, phone, role, status, updated_at")
        .maybeSingle();
      if (error) return fail(res, error.message, 400);
      if (!data) return fail(res, "حساب الأدمن غير موجود في users", 404);
      return ok(res, { admin: data });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

router.get("/daily-report", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
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
      if (isCancelledOrder(r)) continue;
      totalPlatform += Number(r.platform_fee) || 0;
      const de = Number(r.driver_earning);
      const df = Number(r.delivery_fee);
      totalDrivers += de > 0 ? de : df > 0 ? df : 0;
    }

    const totalRevenue = rows.reduce((a, b) => {
      if (isCancelledOrder(b)) return a;
      return a + (Number(b.total_with_vat) || 0);
    }, 0);

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

/** ملخص محفظة ERVENOW (ervenow_wallets): إيداعات مناديب اليوم، عمولة المنصة من طلبات مُسلَّمة (أنشئت اليوم)، وإيراد الطلبات نفس نافذة التقرير اليومي */
router.get("/wallet-ervenow-summary", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const iso = start.toISOString();

    const { data: txs, error: txErr } = await req.supabase
      .from("ervenow_wallet_transactions")
      .select("amount, type, status, created_at")
      .gte("created_at", iso);
    if (txErr) return fail(res, txErr.message, 400);

    let totalDriverEarningsCreditedToday = 0;
    let totalWithdrawsCompletedToday = 0;
    for (const t of txs || []) {
      if (t.status && t.status !== "completed") continue;
      const amt = Number(t.amount) || 0;
      if (t.type === "earning") totalDriverEarningsCreditedToday += amt;
      if (t.type === "withdraw") totalWithdrawsCompletedToday += amt;
    }

    const { data: orders, error: oErr } = await req.supabase
      .from("orders")
      .select("platform_fee, total_with_vat, delivery_status, status")
      .gte("created_at", iso);
    if (oErr) return fail(res, oErr.message, 400);

    let platformCommissionDeliveredToday = 0;
    let dailyRevenueOrdersCreatedToday = 0;
    for (const o of orders || []) {
      if (isCancelledOrder(o)) continue;
      dailyRevenueOrdersCreatedToday += Number(o.total_with_vat) || 0;
      if (String(o.delivery_status || "").toLowerCase() === "delivered") {
        platformCommissionDeliveredToday += Number(o.platform_fee) || 0;
      }
    }

    ok(res, {
      window_start: iso,
      total_driver_earnings_credited_today: round2(totalDriverEarningsCreditedToday),
      total_withdraws_completed_value_today: round2(totalWithdrawsCompletedToday),
      platform_commission_delivered_orders_created_today: round2(platformCommissionDeliveredToday),
      daily_revenue_orders_created_today: round2(dailyRevenueOrdersCreatedToday),
    });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

/** تدقيق: رصيد ervenow_wallets مقابل مجموع الحركات المكتملة (ervenow_wallet_ledger_balance) */
router.get("/wallet-integrity-check", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const { data: wallets, error: wErr } = await req.supabase
      .from("ervenow_wallets")
      .select("user_id, balance, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (wErr) return fail(res, wErr.message, 400);

    const mismatches = [];
    for (const row of wallets || []) {
      const uid = row.user_id;
      const { data: ledgerBal, error: lbErr } = await req.supabase.rpc("ervenow_wallet_ledger_balance", {
        p_user_id: uid,
      });
      if (lbErr) {
        mismatches.push({ user_id: uid, error: lbErr.message });
        continue;
      }
      const b0 = round2(Number(row.balance) || 0);
      const b1 = round2(Number(ledgerBal) || 0);
      if (Math.abs(b0 - b1) > 0.02) {
        mismatches.push({ user_id: uid, stored_balance: b0, ledger_sum: b1, delta: round2(b0 - b1) });
      }
    }
    ok(res, {
      checked: (wallets || []).length,
      mismatches,
      consistent: mismatches.length === 0,
      note: "operational: ervenow_wallets.balance vs ervenow_wallet_ledger_balance(user_id)",
    });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/withdraws", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
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

router.post("/withdraws/:id/approve", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "معرّف طلب السحب مطلوب", 400);

    const { data: rpcData, error: rpcErr } = await req.supabase.rpc("ervenow_wallet_withdraw_atomic", {
      p_withdraw_request_id: id,
    });
    if (rpcErr) return fail(res, rpcErr.message || String(rpcErr), 400);

    const row = typeof rpcData === "object" && rpcData !== null && !Array.isArray(rpcData) ? rpcData : {};
    if (row.ok === true || row.ok === "true") {
      return ok(res, { ok: true, reason: row.reason || "debited", amount: row.amount });
    }

    const reason = String(row.reason || "unknown");
    if (reason === "request_not_found") return fail(res, "طلب السحب غير موجود", 404);
    if (reason === "not_pending") return fail(res, "الطلب ليس قيد المراجعة", 400);
    if (reason === "invalid_amount") return fail(res, "مبلغ غير صالح", 400);
    if (reason === "insufficient_balance") return fail(res, "رصيد المستخدم أقل من المبلغ", 400);
    return fail(res, reason, 400);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/store-requests", requireAuth, requireRole("admin"), requireAdminPermission("stores"), async (req, res) => {
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

router.patch("/store-requests/:id", requireAuth, requireRole("admin"), requireAdminPermission("stores"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "";
    if (!status) return fail(res, "action must be approve or reject", 400);

    const updatePayload = { status, updated_at: new Date().toISOString() };
    if (status === "approved") updatePayload.is_active = true;
    if (status === "rejected") updatePayload.is_active = false;
    const { data, error } = await updateStoreWithOptionalActive(req.supabase, id, updatePayload);
    if (error) {
      if (isStoresTableMissing(error)) {
        return fail(res, "جدول stores غير موجود. نفّذ migration_stores.sql أولاً.", 400);
      }
      return fail(res, error.message, 400);
    }
    if (status === "approved") await linkStoreOwnerAfterApprove(req.supabase, data);
    return ok(res, { request: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/approve-store", requireAuth, requireRole("admin"), requireAdminPermission("stores"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await updateStoreWithOptionalActive(req.supabase, id, {
      status: "approved",
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (isStoresTableMissing(error)) {
        return fail(res, "جدول stores غير موجود. نفّذ migration_stores.sql أولاً.", 400);
      }
      return fail(res, error.message, 400);
    }
    await linkStoreOwnerAfterApprove(req.supabase, data);
    return ok(res, { store: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/reject-store", requireAuth, requireRole("admin"), requireAdminPermission("stores"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await updateStoreWithOptionalActive(req.supabase, id, {
      status: "rejected",
      is_active: false,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (isStoresTableMissing(error)) {
        return fail(res, "جدول stores غير موجود. نفّذ migration_stores.sql أولاً.", 400);
      }
      return fail(res, error.message, 400);
    }
    return ok(res, { store: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.patch("/store/:id/approve", requireAuth, requireRole("admin"), requireAdminPermission("stores"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await updateStoreWithOptionalActive(req.supabase, id, {
      status: "approved",
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (isStoresTableMissing(error)) {
        return fail(res, "جدول stores غير موجود. نفّذ migration_stores.sql أولاً.", 400);
      }
      return fail(res, error.message, 400);
    }
    await linkStoreOwnerAfterApprove(req.supabase, data);
    return ok(res, { store: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/drivers", requireAuth, requireRole("admin"), requireAdminPermission("drivers"), async (req, res) => {
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

router.post("/approve-driver", requireAuth, requireRole("admin"), requireAdminPermission("drivers"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "approved", active: true })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    try {
      await syncUserRoleByPhone(req.supabase, data?.phone, "driver");
      await syncUserStatusByPhone(req.supabase, data?.phone, "active");
    } catch (e) {
      console.error("[admin/approve-driver] user role sync:", e && (e.message || e));
    }
    try {
      if (data?.phone) {
        await sendWhatsApp({
          to: data.phone,
          message: driverApprovedBody(data.name),
        });
      }
    } catch (waErr) {
      console.error("[admin/approve-driver] WhatsApp:", waErr && (waErr.message || String(waErr)));
    }
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/reject-driver", requireAuth, requireRole("admin"), requireAdminPermission("drivers"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "rejected", active: false })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/block-driver", requireAuth, requireRole("admin"), requireAdminPermission("drivers"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "blocked", active: false })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    try {
      await syncUserStatusByPhone(req.supabase, data?.phone, "blocked");
    } catch (e) {
      console.error("[admin/block-driver] user status sync:", e && (e.message || e));
    }
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/activate-driver", requireAuth, requireRole("admin"), requireAdminPermission("drivers"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const { data, error } = await req.supabase
      .from("drivers")
      .update({ status: "approved", active: true })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    try {
      await syncUserRoleByPhone(req.supabase, data?.phone, "driver");
      await syncUserStatusByPhone(req.supabase, data?.phone, "active");
    } catch (e) {
      console.error("[admin/activate-driver] user role sync:", e && (e.message || e));
    }
    return ok(res, { driver: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/customers", requireAuth, requireRole("admin"), requireAdminPermission("customers"), async (req, res) => {
  try {
    const first = await req.supabase
      .from("users")
      .select("id, phone, role, status, created_at")
      .in("role", ["customer", "user"])
      .order("created_at", { ascending: false })
      .limit(500);
    if (!first.error) return ok(res, { customers: first.data || [] });
    if (isSchemaMissingError(first.error)) {
      const fallback = await req.supabase
        .from("users")
        .select("id, phone, role, created_at")
        .in("role", ["customer", "user", "blocked"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (fallback.error) return fail(res, fallback.error.message, 400);
      const mapped = (fallback.data || []).map((u) => ({
        ...u,
        status: String(u.role || "").toLowerCase() === "blocked" ? "blocked" : "active",
      }));
      return ok(res, { customers: mapped });
    }
    return fail(res, first.error.message, 400);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/block-customer", requireAuth, requireRole("admin"), requireAdminPermission("customers"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const first = await req.supabase
      .from("users")
      .update({ status: "blocked", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, phone, role, status, created_at")
      .single();
    if (!first.error) return ok(res, { customer: first.data });
    if (isSchemaMissingError(first.error)) {
      const fallback = await req.supabase
        .from("users")
        .update({ role: "blocked", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id, phone, role, created_at")
        .single();
      if (fallback.error) return fail(res, fallback.error.message, 400);
      return ok(res, {
        customer: {
          ...fallback.data,
          status: "blocked",
        },
      });
    }
    return fail(res, first.error.message, 400);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/activate-customer", requireAuth, requireRole("admin"), requireAdminPermission("customers"), async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return fail(res, "id required", 400);
    const first = await req.supabase
      .from("users")
      .update({ role: "customer", status: "active", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, phone, role, status, created_at")
      .single();
    if (!first.error) return ok(res, { customer: first.data });
    if (isSchemaMissingError(first.error)) {
      const fallback = await req.supabase
        .from("users")
        .update({ role: "customer", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id, phone, role, created_at")
        .single();
      if (fallback.error) return fail(res, fallback.error.message, 400);
      return ok(res, {
        customer: {
          ...fallback.data,
          status: "active",
        },
      });
    }
    return fail(res, first.error.message, 400);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/stats", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (req, res) => {
  try {
    const rangeMeta = resolveRangeWindow(req.query.range);
    const startToday = startOfToday();
    const todayIso = startToday.toISOString();
    const rangeIso = rangeMeta.start.toISOString();

    const orders = await safeSelectRowsWithFallback(req.supabase, "orders", [
      "id, created_at, delivery_status, status, order_total, total_amount, delivery_fee, vat_amount, total_with_vat, platform_fee, driver_earning",
      "id, created_at, delivery_status, status, order_total, total_amount, platform_fee, driver_earning",
    ]);
    const services = await safeSelectRowsWithFallback(req.supabase, "service_bookings", [
      "id, created_at, status, total_amount, total, platform_commission",
      "id, created_at, status, total_amount, total",
      "id, created_at, status, total_amount",
      "id, created_at, status, total",
      "id, created_at, status",
    ]);

    const allOrders = orders || [];
    const allServices = services || [];
    const orderRowsForRange = allOrders.filter((x) => x.created_at >= rangeIso);
    const serviceRowsForRange = allServices.filter((x) => x.created_at >= rangeIso);
    const totalOrders = allOrders.length + allServices.length;
    const todayOrders =
      allOrders.filter((x) => x.created_at >= todayIso).length +
      allServices.filter((x) => x.created_at >= todayIso).length;
    const activeOrders =
      allOrders.filter((x) => ["new", "pending", "accepted", "delivering"].includes(x.delivery_status || x.status))
        .length +
      allServices.filter((x) => ["new", "accepted", "delivering"].includes(x.status)).length;

    const revenueOrders = allOrders.reduce((a, b) => {
      if (isCancelledOrder(b)) return a;
      return a + orderBillableAmount(b);
    }, 0);
    const revenueServices = allServices.reduce((a, b) => {
      const amount = amountFromRow(b);
      return a + amount;
    }, 0);
    const platformOrders = allOrders.reduce((a, b) => {
      if (isCancelledOrder(b)) return a;
      return a + (Number(b.platform_fee) || 0);
    }, 0);
    const platformServices = allServices.reduce((a, b) => a + (Number(b.platform_commission) || 0), 0);
    const driversEarnings = allOrders.reduce((a, b) => {
      if (isCancelledOrder(b)) return a;
      return a + (Number(b.driver_earning) || 0);
    }, 0);
    const revenueOrdersToday = allOrders.reduce((a, b) => {
      if (isCancelledOrder(b)) return a;
      if (!(b.created_at >= todayIso)) return a;
      return a + orderBillableAmount(b);
    }, 0);
    const revenueServicesToday = allServices.reduce((a, b) => {
      if (!(b.created_at >= todayIso)) return a;
      return a + amountFromRow(b);
    }, 0);
    const chart = buildChartForRange([...orderRowsForRange, ...serviceRowsForRange], rangeMeta);

    return ok(res, {
      range: rangeMeta.range,
      total_orders: totalOrders,
      today_orders: todayOrders,
      active_orders: activeOrders,
      total_revenue: round2(revenueOrders + revenueServices),
      platform_commission: round2(platformOrders + platformServices),
      drivers_earnings: round2(driversEarnings),
      ordersToday: todayOrders,
      activeOrders,
      revenueToday: round2(revenueOrdersToday + revenueServicesToday),
      revenueTotal: round2(revenueOrders + revenueServices),
      chart,
    });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/orders", requireAuth, requireRole("admin"), requireAdminPermission("orders"), async (req, res) => {
  try {
    const selectFull =
      "id, order_number, delivery_status, status, created_at, order_total, total_amount, delivery_fee, vat_amount, total_with_vat";
    let { data, error } = await req.supabase
      .from("orders")
      .select(selectFull)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error && isSchemaMissingError(error)) {
      const r2 = await req.supabase
        .from("orders")
        .select("id, order_number, delivery_status, status, created_at, order_total, total_amount")
        .order("created_at", { ascending: false })
        .limit(20);
      data = r2.data;
      error = r2.error;
    }
    if (error) return fail(res, error.message, 400);
    const rows = (data || []).map((o) => {
      if (!isCancelledOrder(o)) {
        const twv = o.total_with_vat;
        if (twv == null || twv === "" || Number(twv) === 0) {
          console.warn("⚠️ Missing total_with_vat", o.id);
        }
      }
      return {
        ...o,
        amount_display: orderBillableAmount(o),
      };
    });
    return ok(res, { orders: rows });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/driver-notifications", requireAuth, requireRole("admin"), requireAdminPermission("notifications"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("driver_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      if (isSchemaMissingError(error)) return ok(res, { items: [] });
      return fail(res, error.message, 400);
    }
    return ok(res, { items: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/complaints", requireAuth, requireRole("admin"), requireAdminPermission("complaints"), async (req, res) => {
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

router.post("/resolve-complaint", requireAuth, requireRole("admin"), requireAdminPermission("complaints"), async (req, res) => {
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

router.get("/providers", requireAuth, requireRole("admin"), requireAdminPermission("providers"), async (req, res) => {
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

router.post("/job-applications/public", async (req, res) => {
  try {
    const sb = req.supabase || req.app?.locals?.supabase || req.supabase || null;
    const serviceSb = sb || require("../../shared/config/supabase").createServiceClient();
    if (!serviceSb) return fail(res, "قاعدة البيانات غير جاهزة", 503);

    const b = req.body || {};
    const name = String(b.name || "").trim();
    const phone = normalizeDigits(b.phone || "");
    const city = String(b.city || "").trim();
    const roleWanted = String(b.role_wanted || "").trim();
    const note = String(b.note || "").trim();
    if (!name) return fail(res, "الاسم مطلوب", 400);
    if (!phone || phone.length < 10) return fail(res, "رقم الجوال غير صالح", 400);

    const { data, error } = await serviceSb
      .from("employee_applications")
      .insert({
        name,
        phone,
        city: city || null,
        role_wanted: roleWanted || null,
        note: note || null,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) {
      if (isEmployeeApplicationsTableMissing(error)) {
        return fail(res, "جدول employee_applications غير موجود. نفّذ migration_employee_applications.sql", 400);
      }
      return fail(res, error.message, 400);
    }
    return ok(res, { application: data });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/job-applications", requireAuth, requireRole("admin"), requireAdminPermission("jobs"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("employee_applications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (isEmployeeApplicationsTableMissing(error)) return ok(res, { applications: [] });
      return fail(res, error.message, 400);
    }
    return ok(res, { applications: data || [] });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post(
  "/job-applications/:id/decision",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("jobs"),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const action = String(req.body?.action || "").trim().toLowerCase();
      const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "";
      if (!id) return fail(res, "id required", 400);
      if (!nextStatus) return fail(res, "action must be approve/reject", 400);

      const { data, error } = await req.supabase
        .from("employee_applications")
        .update({ status: nextStatus, reviewed_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) {
        if (isEmployeeApplicationsTableMissing(error)) {
          return fail(res, "جدول employee_applications غير موجود. نفّذ migration_employee_applications.sql", 400);
        }
        return fail(res, error.message, 400);
      }
      return ok(res, { application: data });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

module.exports = router;
