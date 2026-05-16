const express = require("express");
const path = require("path");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { driverApprovedBody } = require("../../shared/messages/driverWhatsApp");
const { getRiyadhDate } = require("../delivery/service");
const { readState, writeState } = require("../../shared/utils/siteMaintenanceStore");
const { createServiceClient } = require("../../shared/config/supabase");
const platformBranding = require("../../shared/utils/platformBrandingStore");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const { sanitizeDriverOrStoreRowForApi, sanitizeDriverOrStoreListForApi } = require("../../shared/utils/bankApiSafe");
const {
  normalizeScopeType,
  normalizeSlugInput,
  normalizeCategoryScope,
  isCategoriesTableMissing,
  CATEGORY_SCOPE_STORE,
  CATEGORY_SCOPE_PRODUCT,
} = require("../../shared/categoriesDb");
const { recordStoreCategoryUsageOnApprove } = require("../../shared/categoryUsage");
const { acceptOrder } = require("../delivery/service");
const { broadcastOrderPatch, orderPatchFromRow } = require("../../shared/lib/trackingSocket");
const {
  collectDriverCommission,
  getDriverCommissionBalance,
  isDriverLedgerTableMissing,
  DRIVER_DEBT_LIMIT,
  generateReceiptReference,
  roundCollectAmount,
} = require("../../shared/services/driverCommissionLedger");
const {
  CHANNEL: SMART_COLLECTION_CHANNEL,
  COMMISSION_ALERT_THRESHOLD,
  sendSmartCollectionReminder,
} = require("../../shared/services/smartCollectionNotify");

const ADMIN_PUBLIC_ROOT = path.join(__dirname, "../../public");

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
  return /relation .*stores/i.test(msg);
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

router.get("/platform-settings", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (_req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const settings = await platformBranding.loadBranding(sb);
    return ok(res, { settings });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/platform-settings", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const b = req.body || {};
    if (b.resetColors === true || b.resetColors === "true") {
      const settings = await platformBranding.resetColorsToDefaults(sb);
      return ok(res, { settings, message: "تمت إعادة الألوان للوضع الافتراضي" });
    }
    const raw = b.settings && typeof b.settings === "object" ? b.settings : b;
    const settings = await platformBranding.applyBrandingPatch(sb, raw, { publicRoot: ADMIN_PUBLIC_ROOT });
    return ok(res, { settings, message: "تم حفظ إعدادات الهوية" });
  } catch (e) {
    return fail(res, e.message || String(e), 400);
  }
});

router.get("/checkout-payment-methods", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (_req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const methods = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
    return ok(res, { methods });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/checkout-payment-methods", requireAuth, requireRole("admin"), requireAdminPermission("dashboard"), async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const raw = req.body?.methods && typeof req.body.methods === "object" ? req.body.methods : req.body || {};
    const methods = checkoutPaymentMethods.normalizeMethodsPartial(raw);
    await checkoutPaymentMethods.savePlatformPaymentMethodsToDb(sb, methods);
    return ok(res, { methods, message: "تم حفظ وسائل الدفع في السلة" });
  } catch (e) {
    return fail(res, e.message || String(e), 400);
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
    if (error) {
      const msg = String(error.message || "");
      if (/ervenow_withdraw_requests|schema cache|relation/i.test(msg)) {
        return fail(
          res,
          "جدول طلبات السحب غير موجود. نفّذ shared/migration_ervenow_withdraw_requests_schema_cache.sql في Supabase SQL Editor.",
          503
        );
      }
      return fail(res, error.message, 400);
    }
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

/** نوع السحب للموافقة/الرفض الموحّد: driver | store (جسم أو ?kind=) */
function parseWithdrawalKind(req) {
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const q = String(req.query.kind || "").trim().toLowerCase();
  const k = String(b.kind || q || "").trim().toLowerCase();
  if (k === "driver" || k === "drivers") return "driver";
  if (k === "store" || k === "stores") return "store";
  return null;
}

/** يُرفق phone للمستخدم لعرض أفضل في لوحة السحب (بدون تعديل DB). */
async function attachUserPhonesForWithdrawals(sb, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map((r) => r && r.user_id).filter(Boolean))];
  if (!ids.length) return list;
  const { data: users, error } = await sb.from("users").select("id, phone").in("id", ids);
  if (error || !users) return list;
  const map = new Map(users.map((u) => [String(u.id), u.phone]));
  return list.map((r) => ({ ...r, user_phone: map.get(String(r.user_id)) || null }));
}

async function attachStoreNamesForWithdrawals(sb, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map((r) => r && r.store_id).filter(Boolean))];
  if (!ids.length) return list;
  const { data: stores, error } = await sb.from("stores").select("id, name, phone").in("id", ids);
  if (error || !stores) return list;
  const map = new Map(stores.map((s) => [String(s.id), { name: s.name, phone: s.phone }]));
  return list.map((r) => {
    const s = map.get(String(r.store_id));
    return { ...r, store_name: s ? s.name : null, store_phone: s ? s.phone : null };
  });
}

router.get("/withdrawals/drivers", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const statusQ = String(req.query.status || "").trim().toLowerCase();
    let q = req.supabase
      .from("ervenow_withdraw_requests")
      .select("id, user_id, amount, status, iban, note, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusQ === "pending" || statusQ === "approved" || statusQ === "rejected" || statusQ === "paid") {
      q = q.eq("status", statusQ);
    }
    const { data, error } = await q;
    if (error) {
      const msg = String(error.message || "");
      if (/ervenow_withdraw_requests|schema cache|relation/i.test(msg)) {
        return fail(
          res,
          "جدول طلبات السحب غير موجود. نفّذ shared/migration_ervenow_withdraw_requests_schema_cache.sql في Supabase SQL Editor.",
          503
        );
      }
      return fail(res, error.message, 400);
    }
    const enriched = await attachUserPhonesForWithdrawals(req.supabase, data || []);
    return ok(res, { withdrawals: enriched, kind: "driver" });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/withdrawals/stores", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const statusQ = String(req.query.status || "").trim().toLowerCase();
    let q = req.supabase
      .from("store_withdrawals")
      .select("id, store_id, amount, status, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusQ === "pending" || statusQ === "approved" || statusQ === "rejected") {
      q = q.eq("status", statusQ);
    }
    const { data, error } = await q;
    if (error) {
      const msg = String(error.message || "");
      if (/store_withdrawals|schema cache|relation .*store_withdrawals/i.test(msg)) {
        return ok(res, { withdrawals: [], kind: "store", note: "migration_store_withdrawals.sql" });
      }
      return fail(res, error.message, 400);
    }
    const enriched = await attachStoreNamesForWithdrawals(req.supabase, data || []);
    return ok(res, { withdrawals: enriched, kind: "store" });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/withdrawals/:id/approve", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "معرّف طلب السحب مطلوب", 400);
    const kind = parseWithdrawalKind(req);
    if (!kind) {
      return fail(res, "حدّد نوع الطلب: أرسل في الجسم { \"kind\": \"driver\" } أو { \"kind\": \"store\" } (أو ?kind=)", 400);
    }
    if (kind === "driver") {
      const { data: rpcData, error: rpcErr } = await req.supabase.rpc("ervenow_wallet_withdraw_atomic", {
        p_withdraw_request_id: id,
      });
      if (rpcErr) return fail(res, rpcErr.message || String(rpcErr), 400);
      const row = typeof rpcData === "object" && rpcData !== null && !Array.isArray(rpcData) ? rpcData : {};
      if (row.ok === true || row.ok === "true") {
        return ok(res, { ok: true, kind: "driver", reason: row.reason || "debited", amount: row.amount });
      }
      const reason = String(row.reason || "unknown");
      if (reason === "request_not_found") return fail(res, "طلب السحب غير موجود", 404);
      if (reason === "not_pending") return fail(res, "الطلب ليس قيد المراجعة", 400);
      if (reason === "invalid_amount") return fail(res, "مبلغ غير صالح", 400);
      if (reason === "insufficient_balance") return fail(res, "رصيد المستخدم أقل من المبلغ", 400);
      return fail(res, reason, 400);
    }
    const { data: rpcData, error: rpcErr } = await req.supabase.rpc("store_wallet_approve_withdrawal", {
      p_withdrawal_id: id,
    });
    if (rpcErr) {
      const msg = String(rpcErr.message || rpcErr.details || "");
      if (/function .*does not exist|schema cache/i.test(msg)) {
        return fail(res, "نفّذ migration_store_withdrawals.sql في قاعدة البيانات", 400);
      }
      return fail(res, rpcErr.message || String(rpcErr), 400);
    }
    const row = typeof rpcData === "object" && rpcData !== null && !Array.isArray(rpcData) ? rpcData : {};
    if (row.ok === true || row.ok === "true") {
      return ok(res, { ok: true, kind: "store", reason: row.reason || "approved", amount: row.amount });
    }
    const reason = String(row.reason || "unknown");
    if (reason === "not_found") return fail(res, "طلب السحب غير موجود", 404);
    if (reason === "not_pending") return fail(res, "الطلب ليس قيد المراجعة", 400);
    if (reason === "insufficient_balance") return fail(res, "رصيد المتجر غير كافٍ", 400);
    return fail(res, reason, 400);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/withdrawals/:id/reject", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "معرّف طلب السحب مطلوب", 400);
    const kind = parseWithdrawalKind(req);
    if (!kind) {
      return fail(res, "حدّد نوع الطلب: أرسل في الجسم { \"kind\": \"driver\" } أو { \"kind\": \"store\" } (أو ?kind=)", 400);
    }
    const now = new Date().toISOString();
    if (kind === "driver") {
      const { data, error } = await req.supabase
        .from("ervenow_withdraw_requests")
        .update({ status: "rejected", processed_at: now })
        .eq("id", id)
        .eq("status", "pending")
        .select("id, status")
        .maybeSingle();
      if (error) return fail(res, error.message, 400);
      if (!data) return fail(res, "الطلب غير موجود أو ليس قيد المراجعة", 400);
      return ok(res, { ok: true, kind: "driver", id: data.id, status: data.status });
    }
    const { data, error } = await req.supabase
      .from("store_withdrawals")
      .update({ status: "rejected", updated_at: now })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, status")
      .maybeSingle();
    if (error) {
      const msg = String(error.message || "");
      if (/store_withdrawals|schema cache|relation/i.test(msg)) {
        return fail(res, "جدول سحوبات المتاجر غير جاهز", 400);
      }
      return fail(res, error.message, 400);
    }
    if (!data) return fail(res, "الطلب غير موجود أو ليس قيد المراجعة", 400);
    return ok(res, { ok: true, kind: "store", id: data.id, status: data.status });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/store-withdrawals", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (req, res) => {
  try {
    const statusQ = String(req.query.status || "").trim().toLowerCase();
    let q = req.supabase
      .from("store_withdrawals")
      .select("id,store_id,amount,status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusQ === "pending" || statusQ === "approved" || statusQ === "rejected") {
      q = q.eq("status", statusQ);
    }
    const { data, error } = await q;
    if (error) {
      const msg = String(error.message || "");
      if (/store_withdrawals|schema cache|relation .*store_withdrawals/i.test(msg)) {
        return ok(res, { withdrawals: [], note: "migration_store_withdrawals.sql" });
      }
      return fail(res, error.message, 400);
    }
    ok(res, { withdrawals: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post(
  "/store-withdrawals/:id/approve",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return fail(res, "معرّف طلب السحب مطلوب", 400);

      const { data: rpcData, error: rpcErr } = await req.supabase.rpc("store_wallet_approve_withdrawal", {
        p_withdrawal_id: id,
      });
      if (rpcErr) {
        const msg = String(rpcErr.message || rpcErr.details || "");
        if (/function .*does not exist|schema cache/i.test(msg)) {
          return fail(res, "نفّذ migration_store_withdrawals.sql في قاعدة البيانات", 400);
        }
        return fail(res, rpcErr.message || String(rpcErr), 400);
      }

      const row = typeof rpcData === "object" && rpcData !== null && !Array.isArray(rpcData) ? rpcData : {};
      if (row.ok === true || row.ok === "true") {
        return ok(res, { ok: true, reason: row.reason || "approved", amount: row.amount });
      }

      const reason = String(row.reason || "unknown");
      if (reason === "not_found") return fail(res, "طلب السحب غير موجود", 404);
      if (reason === "not_pending") return fail(res, "الطلب ليس قيد المراجعة", 400);
      if (reason === "insufficient_balance") return fail(res, "رصيد المتجر غير كافٍ", 400);
      return fail(res, reason, 400);
    } catch (e) {
      fail(res, e.message, 500);
    }
  }
);

router.get("/store-requests", requireAuth, requireRole("admin"), requireAdminPermission("stores"), async (req, res) => {
  try {
    const statusQ = String(req.query.status || "").trim().toLowerCase();
    let q = req.supabase.from("stores").select("*").order("created_at", { ascending: false }).limit(300);
    if (statusQ) q = q.eq("status", statusQ);
    const { data, error } = await q;
    if (error) {
      return fail(res, error.message || String(error), 400);
    }
    return ok(res, { requests: sanitizeDriverOrStoreListForApi(data || []) });
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
      return fail(res, error.message || String(error), 400);
    }
    if (status === "approved") await linkStoreOwnerAfterApprove(req.supabase, data);
    if (status === "approved") recordStoreCategoryUsageOnApprove(data);
    return ok(res, { request: sanitizeDriverOrStoreRowForApi(data) });
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
      return fail(res, error.message || String(error), 400);
    }
    await linkStoreOwnerAfterApprove(req.supabase, data);
    recordStoreCategoryUsageOnApprove(data);
    return ok(res, { store: sanitizeDriverOrStoreRowForApi(data) });
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
      return fail(res, error.message || String(error), 400);
    }
    return ok(res, { store: sanitizeDriverOrStoreRowForApi(data) });
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
      return fail(res, error.message || String(error), 400);
    }
    await linkStoreOwnerAfterApprove(req.supabase, data);
    recordStoreCategoryUsageOnApprove(data);
    return ok(res, { store: sanitizeDriverOrStoreRowForApi(data) });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

async function attachUserIdsToDrivers(sb, drivers) {
  const list = Array.isArray(drivers) ? drivers : [];
  const phones = [...new Set(list.map((d) => normalizeDigits(d && d.phone)).filter(Boolean))];
  if (!phones.length) {
    return list.map((d) => ({ ...d, user_id: d.user_id || null }));
  }
  const { data: users, error } = await sb.from("users").select("id, phone").in("phone", phones);
  if (error) return list;
  const map = new Map();
  for (const u of users || []) {
    const p = normalizeDigits(u.phone);
    if (p) map.set(p, u.id);
  }
  return list.map((d) => ({
    ...d,
    user_id: map.get(normalizeDigits(d.phone)) || d.user_id || null,
  }));
}

async function resolveDriverUserIdForAssign(sb, body) {
  const raw = String(
    body?.driver_user_id || body?.driverUserId || body?.driver_id || body?.driverId || ""
  ).trim();
  if (!raw) return { error: "مطلوب معرّف المندوب" };

  const { data: userById } = await sb.from("users").select("id, role, phone").eq("id", raw).maybeSingle();
  if (userById && String(userById.role || "").toLowerCase() === "driver") {
    return { userId: userById.id };
  }

  const { data: drv } = await sb.from("drivers").select("id, phone, status, active").eq("id", raw).maybeSingle();
  if (drv) {
    const st = String(drv.status || "").toLowerCase();
    if (st !== "approved" && drv.active !== true) {
      return { error: "المندوب غير معتمد أو غير نشط" };
    }
    const phone = normalizeDigits(drv.phone);
    if (!phone) return { error: "رقم المندوب غير صالح" };
    const { data: u } = await sb.from("users").select("id, role").eq("phone", phone).maybeSingle();
    if (!u || !u.id) return { error: "لا يوجد حساب مستخدم مرتبط بهذا المندوب" };
    return { userId: u.id, driver: drv };
  }

  if (userById && userById.id) return { userId: userById.id };
  return { error: "مندوب غير معروف" };
}

router.get("/drivers", requireAuth, requireRole("admin"), requireAdminPermission("drivers"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return fail(res, error.message, 400);
    const enriched = await attachUserIdsToDrivers(req.supabase, data || []);
    return ok(res, { drivers: sanitizeDriverOrStoreListForApi(enriched) });
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
    return ok(res, { driver: sanitizeDriverOrStoreRowForApi(data) });
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
    return ok(res, { driver: sanitizeDriverOrStoreRowForApi(data) });
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
    return ok(res, { driver: sanitizeDriverOrStoreRowForApi(data) });
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
    return ok(res, { driver: sanitizeDriverOrStoreRowForApi(data) });
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

/** لقطة أرصدة المنصة والسيولة (محاسبة + تشغيل + متاجر) — أدمن بصلاحية finance فقط */
router.get("/platform-treasury", requireAuth, requireRole("admin"), requireAdminPermission("finance"), async (_req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const { data, error } = await sb.rpc("admin_platform_treasury_summary");
    if (error) {
      const msg = error.message || String(error);
      if (/does not exist|42883|admin_platform_treasury|schema cache/i.test(msg)) {
        return fail(
          res,
          "لم تُنفَّذ دالة قاعدة البيانات — نفّذ shared/migration_admin_platform_treasury.sql على Supabase",
          503
        );
      }
      return fail(res, msg, 400);
    }
    let raw = data;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = {};
      }
    }
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) raw = {};
    const safe = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? round2(x) : 0;
    };
    const treasury = {
      platform_accounting_balance: safe(raw.platform_accounting_balance),
      ervenow_operational_balance_sum: safe(raw.ervenow_operational_balance_sum),
      store_wallets_balance_sum: safe(raw.store_wallets_balance_sum),
      pending_withdraw_requests_sum: safe(raw.pending_withdraw_requests_sum),
      ervenow_wallets_count: Number(raw.ervenow_wallets_count) || 0,
      store_wallets_count: Number(raw.store_wallets_count) || 0,
      circulating_reference_total: safe(raw.circulating_reference_total),
    };
    return ok(res, { treasury });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/orders", requireAuth, requireRole("admin"), requireAdminPermission("orders"), async (req, res) => {
  try {
    const selectFull =
      "id, order_number, delivery_status, status, created_at, order_total, total_amount, delivery_fee, vat_amount, total_with_vat, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_address, drop_address, platform_fee";
    let { data, error } = await req.supabase
      .from("orders")
      .select(selectFull)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error && isSchemaMissingError(error)) {
      const r2 = await req.supabase
        .from("orders")
        .select(
          "id, order_number, delivery_status, status, created_at, order_total, total_amount, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng"
        )
        .order("created_at", { ascending: false })
        .limit(80);
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

router.post(
  "/orders/:id/assign-driver",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("orders"),
  async (req, res) => {
    try {
      const orderId = String(req.params.id || "").trim();
      if (!orderId) return fail(res, "id required", 400);
      const resolved = await resolveDriverUserIdForAssign(req.supabase, req.body || {});
      if (resolved.error) return fail(res, resolved.error, 400);

      const { data: order, error: oErr } = await req.supabase
        .from("orders")
        .select("id, driver_id, delivery_status, status")
        .eq("id", orderId)
        .maybeSingle();
      if (oErr || !order) return fail(res, oErr?.message || "الطلب غير موجود", 404);

      const ds = String(order.delivery_status || order.status || "").toLowerCase();
      if (["delivered", "cancelled", "canceled", "cancelled_by_customer", "canceled_by_customer"].includes(ds)) {
        return fail(res, "لا يمكن تعيين مندوب لطلب منتهٍ", 400);
      }
      if (order.driver_id) return fail(res, "الطلب مرتبط بمندوب — استخدم تحويل المندوب", 409);

      let data = null;
      let error = null;
      const accepted = await acceptOrder(req.supabase, orderId, resolved.userId);
      data = accepted.data;
      error = accepted.error;
      if (error) {
        const nextStatus = ds === "new" || ds === "pending" || !ds ? "accepted" : order.delivery_status || order.status;
        const r2 = await req.supabase
          .from("orders")
          .update({
            driver_id: resolved.userId,
            delivery_status: nextStatus,
            status: nextStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId)
          .select()
          .single();
        data = r2.data;
        error = r2.error;
      }
      if (error) return fail(res, error.message || "تعذر تعيين المندوب", 400);
      if (data && data.id) broadcastOrderPatch(String(data.id), orderPatchFromRow(data));
      return ok(res, { order: data, driver_user_id: resolved.userId });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

router.post(
  "/orders/:id/transfer-driver",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("orders"),
  async (req, res) => {
    try {
      const orderId = String(req.params.id || "").trim();
      if (!orderId) return fail(res, "id required", 400);
      const resolved = await resolveDriverUserIdForAssign(req.supabase, req.body || {});
      if (resolved.error) return fail(res, resolved.error, 400);

      const { data: order, error: oErr } = await req.supabase
        .from("orders")
        .select("id, driver_id, delivery_status, status")
        .eq("id", orderId)
        .maybeSingle();
      if (oErr || !order) return fail(res, oErr?.message || "الطلب غير موجود", 404);

      const ds = String(order.delivery_status || order.status || "").toLowerCase();
      if (["delivered", "cancelled", "canceled", "cancelled_by_customer", "canceled_by_customer"].includes(ds)) {
        return fail(res, "لا يمكن تحويل مندوب لطلب منتهٍ", 400);
      }

      const { data, error } = await req.supabase
        .from("orders")
        .update({
          driver_id: resolved.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .select()
        .single();
      if (error) return fail(res, error.message || "تعذر تحويل المندوب", 400);
      if (data && data.id) broadcastOrderPatch(String(data.id), orderPatchFromRow(data));
      return ok(res, { order: data, driver_user_id: resolved.userId });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

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

router.get(
  "/categories",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("stores"),
  async (req, res) => {
    try {
      const scope = normalizeScopeType(req.query.type);
      if (!scope) return fail(res, "أرسل type=restaurant أو type=market", 400);
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
      const { data, error } = await sb
        .from("categories")
        .select("id,type,scope,slug,name_ar,icon,image_url,sort_order,is_active,usage_count,last_used_at,created_at,updated_at")
        .eq("type", scope)
        .order("usage_count", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name_ar", { ascending: true });
      if (error) {
        if (isCategoriesTableMissing(error)) {
          return ok(res, { ok: true, categories: [], note: "نفّذ shared/migration_categories.sql في Supabase" });
        }
        if (!/usage_count|last_used_at|column|schema cache/i.test(String(error.message || ""))) {
          return fail(res, error.message, 400);
        }
        const r2 = await sb
          .from("categories")
          .select("id,type,scope,slug,name_ar,icon,image_url,sort_order,is_active,created_at,updated_at")
          .eq("type", scope)
          .order("sort_order", { ascending: true })
          .order("name_ar", { ascending: true });
        if (r2.error) {
          if (isCategoriesTableMissing(r2.error)) {
            return ok(res, { ok: true, categories: [], note: "نفّذ shared/migration_categories.sql في Supabase" });
          }
          return fail(res, r2.error.message, 400);
        }
        return ok(res, { ok: true, categories: r2.data || [] });
      }
      return ok(res, { ok: true, categories: data || [] });
    } catch (e) {
      console.error("[admin/categories/list]", e);
      return fail(res, e.message || "خطأ في الخادم", 500);
    }
  }
);

router.post(
  "/categories",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("stores"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const type = normalizeScopeType(body.type);
      const slug = normalizeSlugInput(body.slug);
      const name_ar = String(body.name_ar || body.label_ar || "").trim();
      const catScope = normalizeCategoryScope(body.scope, type);
      if (!type || !slug || !name_ar) return fail(res, "type و slug و name_ar (أو label_ar) مطلوبة", 400);
      if (!catScope) return fail(res, "scope غير صالح — استخدم store أو product", 400);
      if (type === "restaurant" && catScope !== CATEGORY_SCOPE_STORE) {
        return fail(res, "أقسام المطاعم يجب أن تكون scope=store", 400);
      }
      if (type === "market" && catScope !== CATEGORY_SCOPE_PRODUCT) {
        return fail(res, "أقسام البقالة يجب أن تكون scope=product", 400);
      }
      const icon =
        body.icon != null && String(body.icon).trim() !== "" ? String(body.icon).trim().slice(0, 32) : null;
      const image_url =
        body.image_url != null && String(body.image_url).trim() !== ""
          ? String(body.image_url).trim().slice(0, 2048)
          : null;
      let sort_order = Number(body.sort_order);
      if (!Number.isFinite(sort_order)) sort_order = 0;
      const is_active = body.is_active !== false;
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
      const now = new Date().toISOString();
      const { data, error } = await sb
        .from("categories")
        .insert({
          type,
          scope: catScope,
          slug,
          name_ar,
          icon,
          image_url,
          sort_order,
          is_active,
          updated_at: now,
        })
        .select("*")
        .single();
      if (error) {
        if (isCategoriesTableMissing(error)) {
          return fail(res, "جدول categories غير موجود — نفّذ shared/migration_categories.sql", 400);
        }
        if (String(error.code) === "23505") return fail(res, "slug موجود مسبقاً", 409);
        return fail(res, error.message, 400);
      }
      return ok(res, { ok: true, category: data });
    } catch (e) {
      console.error("[admin/categories/create]", e);
      return fail(res, e.message || "خطأ في الخادم", 500);
    }
  }
);

router.put(
  "/categories/:id",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("stores"),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return fail(res, "id مطلوب", 400);
      const body = req.body || {};
      const patch = { updated_at: new Date().toISOString() };
      if (body.name_ar !== undefined || body.label_ar !== undefined) {
        const la = String((body.name_ar != null ? body.name_ar : body.label_ar) || "").trim();
        if (!la) return fail(res, "name_ar لا يمكن أن يكون فارغاً", 400);
        patch.name_ar = la;
      }
      if (body.scope !== undefined) {
        const sc = normalizeCategoryScope(body.scope, body.type || patch.type);
        if (!sc) return fail(res, "scope غير صالح", 400);
        patch.scope = sc;
      }
      if (body.image_url !== undefined) {
        patch.image_url =
          body.image_url === null || body.image_url === ""
            ? null
            : String(body.image_url).trim().slice(0, 2048);
      }
      if (body.icon !== undefined) {
        patch.icon = body.icon === null || body.icon === "" ? null : String(body.icon).trim().slice(0, 32);
      }
      if (body.sort_order != null) {
        const n = Number(body.sort_order);
        if (Number.isFinite(n)) patch.sort_order = n;
      }
      if (body.is_active !== undefined) patch.is_active = !!body.is_active;
      if (body.slug != null) {
        const s = normalizeSlugInput(body.slug);
        if (!s) return fail(res, "slug غير صالح (أحرف صغيرة وأرقام و _ و -)", 400);
        patch.slug = s;
      }
      if (body.type != null) {
        const t = normalizeScopeType(body.type);
        if (!t) return fail(res, "type غير صالح", 400);
        patch.type = t;
      }
      const meaningfulKeys = Object.keys(patch).filter((k) => k !== "updated_at");
      if (!meaningfulKeys.length) return fail(res, "لا يوجد حقول للتحديث", 400);
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
      const { data, error } = await sb.from("categories").update(patch).eq("id", id).select("*").maybeSingle();
      if (error) {
        if (isCategoriesTableMissing(error)) return fail(res, "جدول categories غير موجود", 400);
        if (String(error.code) === "23505") return fail(res, "slug موجود مسبقاً", 409);
        return fail(res, error.message, 400);
      }
      if (!data) return fail(res, "القسم غير موجود", 404);
      return ok(res, { ok: true, category: data });
    } catch (e) {
      console.error("[admin/categories/update]", e);
      return fail(res, e.message || "خطأ في الخادم", 500);
    }
  }
);

router.delete(
  "/categories/:id",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("stores"),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return fail(res, "id مطلوب", 400);
      const sb = createServiceClient();
      if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
      const now = new Date().toISOString();
      const { data, error } = await sb
        .from("categories")
        .update({ is_active: false, updated_at: now })
        .eq("id", id)
        .select("id,is_active")
        .maybeSingle();
      if (error) {
        if (isCategoriesTableMissing(error)) return fail(res, "جدول categories غير موجود", 400);
        return fail(res, error.message, 400);
      }
      if (!data) return fail(res, "القسم غير موجود", 404);
      return ok(res, { ok: true, id: data.id, is_active: data.is_active, note: "تم التعطيل (حذف ناعم)" });
    } catch (e) {
      console.error("[admin/categories/delete]", e);
      return fail(res, e.message || "خطأ في الخادم", 500);
    }
  }
);

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

/** مديونيات عمولة مزودي الخدمة (من أتمّوا مهاماً ولم يورّدوا العمولة) */
router.get(
  "/provider-debts",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
      const status = String(req.query.status || "pending").trim().toLowerCase();
      let q = sb
        .from("provider_commission_debts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (status && status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) {
        if (/does not exist|relation|schema cache/i.test(String(error.message || ""))) {
          return ok(res, { debts: [], note: "نفّذ shared/migration_gas_service_and_debts.sql" });
        }
        return fail(res, error.message, 400);
      }
      const debts = data || [];
      const pendingSum = debts
        .filter((d) => String(d.status || "").toLowerCase() === "pending")
        .reduce((s, d) => s + (Number(d.commission_amount) || 0), 0);
      return ok(res, {
        debts,
        summary: { count: debts.length, pending_total: Math.round(pendingSum * 100) / 100 },
      });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

/** مديونيات عمولة COD للمندوبين (driver_wallets + driver_ledger) */
router.get(
  "/driver-debts",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);

      const { data: wallets, error: wErr } = await sb
        .from("driver_wallets")
        .select("driver_id, balance, updated_at")
        .order("balance", { ascending: false })
        .limit(500);
      if (wErr) {
        if (isDriverLedgerTableMissing(wErr)) {
          return ok(res, {
            drivers: [],
            debt_limit: DRIVER_DEBT_LIMIT,
            note: "نفّذ shared/migration_driver_commission_ledger.sql",
          });
        }
        return fail(res, wErr.message, 400);
      }

      const walletRows = wallets || [];
      const driverIds = walletRows.map((w) => w.driver_id).filter(Boolean);
      const counts = {};
      if (driverIds.length) {
        const { data: ledgerRows, error: lErr } = await sb
          .from("driver_ledger")
          .select("driver_id")
          .in("driver_id", driverIds);
        if (lErr && !isDriverLedgerTableMissing(lErr)) return fail(res, lErr.message, 400);
        for (const row of ledgerRows || []) {
          const id = String(row.driver_id);
          counts[id] = (counts[id] || 0) + 1;
        }
      }

      const { data: driversTbl } = await sb.from("drivers").select("id, name, phone, status, active").limit(500);
      const { data: usersTbl } =
        driverIds.length > 0
          ? await sb.from("users").select("id, phone").in("id", driverIds)
          : { data: [] };

      const phoneToDriver = new Map();
      for (const d of driversTbl || []) {
        const ph = normalizeDigits(d.phone);
        if (ph) phoneToDriver.set(ph, d);
      }
      const userPhone = new Map((usersTbl || []).map((u) => [String(u.id), normalizeDigits(u.phone)]));

      const riyadhDay = getRiyadhDate();
      const dayStartIso = `${riyadhDay}T00:00:00.000+03:00`;
      const notifyByPhone = new Map();
      try {
        const { data: notifyRows } = await sb
          .from("driver_notifications")
          .select("phone, status, error, created_at, sent_at")
          .eq("channel", SMART_COLLECTION_CHANNEL)
          .gte("created_at", dayStartIso)
          .order("created_at", { ascending: false })
          .limit(800);
        for (const n of notifyRows || []) {
          const nph = normalizeDigits(n.phone);
          if (!nph || notifyByPhone.has(nph)) continue;
          const err = String(n.error || "");
          notifyByPhone.set(nph, {
            notify_status: String(n.status || "pending"),
            notify_kind: err.includes("threshold") ? "threshold" : "delivery",
            notify_at: n.sent_at || n.created_at || null,
          });
        }
      } catch (_nErr) {}

      const drivers = walletRows.map((w) => {
        const uid = String(w.driver_id);
        const ph = userPhone.get(uid) || "";
        const prof = ph ? phoneToDriver.get(ph) : null;
        const bal = round2(Number(w.balance) || 0);
        const phoneKey = normalizeDigits(prof?.phone || ph || "");
        const notify = phoneKey ? notifyByPhone.get(phoneKey) : null;
        return {
          driver_id: uid,
          driver_record_id: prof?.id || null,
          name: prof?.name || null,
          phone: prof?.phone || ph || null,
          status: prof?.status || null,
          balance: bal,
          operations_count: counts[uid] || 0,
          debt_blocked: bal > DRIVER_DEBT_LIMIT,
          updated_at: w.updated_at,
          alert_balance: bal > COMMISSION_ALERT_THRESHOLD,
          notify_status: notify?.notify_status || null,
          notify_kind: notify?.notify_kind || null,
          notify_at: notify?.notify_at || null,
        };
      });

      const totalDue = drivers.reduce((s, d) => s + (Number(d.balance) || 0), 0);
      return ok(res, {
        drivers,
        summary: {
          count: drivers.length,
          total_balance_due: round2(totalDue),
          debt_limit: DRIVER_DEBT_LIMIT,
          alert_threshold: COMMISSION_ALERT_THRESHOLD,
        },
        debt_limit: DRIVER_DEBT_LIMIT,
        smart_collection: {
          alert_threshold: COMMISSION_ALERT_THRESHOLD,
          channel: SMART_COLLECTION_CHANNEL,
        },
      });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

router.get(
  "/driver-ledger/:id",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
      const driverId = String(req.params.id || "").trim();
      if (!driverId) return fail(res, "driver id required", 400);

      const { data: wallet, error: wErr } = await sb
        .from("driver_wallets")
        .select("driver_id, balance, updated_at")
        .eq("driver_id", driverId)
        .maybeSingle();
      if (wErr) {
        if (isDriverLedgerTableMissing(wErr)) {
          return ok(res, { driver_id: driverId, entries: [], note: "نفّذ migration_driver_commission_ledger.sql" });
        }
        return fail(res, wErr.message, 400);
      }

      const { data: entries, error: eErr } = await sb
        .from("driver_ledger")
        .select("id, driver_id, order_id, type, amount, meta, created_at")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (eErr) return fail(res, eErr.message, 400);

      const balance = wallet ? round2(Number(wallet.balance) || 0) : 0;
      return ok(res, {
        driver_id: driverId,
        balance,
        debt_blocked: balance > DRIVER_DEBT_LIMIT,
        debt_limit: DRIVER_DEBT_LIMIT,
        operations_count: (entries || []).length,
        entries: entries || [],
        wallet: wallet || { driver_id: driverId, balance: 0 },
      });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

router.post(
  "/collect",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
      const driverId = String(req.body?.driver_id || req.body?.driverId || "").trim();
      const amountRaw = Number(req.body?.amount);
      if (!driverId) return fail(res, "driver_id required", 400);
      if (!Number.isFinite(amountRaw)) return fail(res, "amount must be a valid number", 400);
      const amount = roundCollectAmount(amountRaw);
      if (amount <= 0) return fail(res, "amount must be positive (rounded to 2 decimals)", 400);

      const balanceBefore = await getDriverCommissionBalance(sb, driverId);
      if (amount > round2(balanceBefore) + 0.004) {
        return fail(
          res,
          `المبلغ (${amount.toFixed(2)}) أكبر من الرصيد المستحق (${round2(balanceBefore).toFixed(2)})`,
          400
        );
      }

      const receiptReference = generateReceiptReference();
      const note = String(req.body?.note || "").trim().slice(0, 500);
      const adminId = req.appUser?.id || null;
      let result;
      try {
        result = await collectDriverCommission(sb, driverId, amount, {
          note: note || null,
          collected_by: adminId,
          source: "admin_collect",
          receipt_reference: receiptReference,
        });
      } catch (err) {
        if (isDriverLedgerTableMissing(err)) {
          return fail(res, "نفّذ shared/migration_driver_commission_ledger.sql على Supabase", 503);
        }
        if (String(err.message || "").includes("insufficient_balance")) {
          return fail(res, "المبلغ أكبر من الرصيد المستحق", 400);
        }
        throw err;
      }

      if (result.ok === false) {
        const reason = result.reason || "collect_failed";
        if (reason === "insufficient_balance") {
          return fail(res, "المبلغ أكبر من الرصيد المستحق", 400);
        }
        return fail(res, reason, 400);
      }

      const balanceAfter = await getDriverCommissionBalance(sb, driverId);
      return ok(res, {
        ok: true,
        driver_id: driverId,
        collected: round2(amount),
        balance_before: round2(balanceBefore),
        balance_after: balanceAfter,
        debt_blocked: balanceAfter > DRIVER_DEBT_LIMIT,
        ledger_id: result.ledger_id || null,
        receipt_reference: receiptReference,
        amount_rounded: Math.abs(amountRaw - amount) > 0.001,
        result,
      });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

/** تذكير واتساب لمندوب — Smart Collection */
router.post(
  "/smart-collection-remind",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
      const driverId = String(req.body?.driver_id || req.body?.driverId || "").trim();
      if (!driverId) return fail(res, "driver_id required", 400);
      const out = await sendSmartCollectionReminder(sb, driverId);
      if (out.reason === "no_phone") return fail(res, "لا يوجد جوال للمندوب", 400);
      if (out.reason === "no_balance") {
        return fail(res, "لا يوجد رصيد مستحق — لا حاجة لتذكير", 400);
      }
      if (!out.sent) return fail(res, "تعذّر إرسال واتساب — تحقق من إعدادات WA", 502);
      return ok(res, out);
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

/** تقرير يومي — Smart Collection (إضافة) */
router.get(
  "/smart-collection-daily-report",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
      const riyadhDay = getRiyadhDate();
      const dayStartIso = `${riyadhDay}T00:00:00.000+03:00`;

      let commissionsToday = 0;
      let collectionsToday = 0;
      let ledgerOpsToday = 0;
      try {
        const { data: ledgerToday, error: lErr } = await sb
          .from("driver_ledger")
          .select("type, amount, created_at")
          .gte("created_at", dayStartIso)
          .limit(5000);
        if (!lErr && ledgerToday) {
          for (const row of ledgerToday) {
            ledgerOpsToday += 1;
            const amt = Number(row.amount) || 0;
            const typ = String(row.type || "").toLowerCase();
            if (typ === "commission") commissionsToday += amt;
            if (typ === "payout") collectionsToday += Math.abs(amt);
          }
        }
      } catch (_le) {}

      let notificationsSent = 0;
      let notificationsFailed = 0;
      try {
        const { data: notes } = await sb
          .from("driver_notifications")
          .select("status")
          .eq("channel", SMART_COLLECTION_CHANNEL)
          .gte("created_at", dayStartIso)
          .limit(2000);
        for (const n of notes || []) {
          const st = String(n.status || "").toLowerCase();
          if (st === "sent") notificationsSent += 1;
          else if (st === "failed") notificationsFailed += 1;
        }
      } catch (_ne) {}

      const { data: wallets } = await sb.from("driver_wallets").select("balance").limit(500);
      const rows = wallets || [];
      const totalDebt = round2(rows.reduce((s, w) => s + (Number(w.balance) || 0), 0));
      const withDebt = rows.filter((w) => (Number(w.balance) || 0) > 0).length;
      const blocked = rows.filter((w) => (Number(w.balance) || 0) > DRIVER_DEBT_LIMIT).length;
      const aboveAlert = rows.filter((w) => (Number(w.balance) || 0) > COMMISSION_ALERT_THRESHOLD).length;

      const report = {
        date: riyadhDay,
        timezone: "Asia/Riyadh",
        total_debt: totalDebt,
        drivers_with_debt: withDebt,
        blocked_drivers: blocked,
        drivers_above_alert: aboveAlert,
        ledger_operations_today: ledgerOpsToday,
        commissions_accrued_today: round2(commissionsToday),
        collections_today: round2(collectionsToday),
        driver_notifications_sent: notificationsSent,
        driver_notifications_failed: notificationsFailed,
        alert_threshold: COMMISSION_ALERT_THRESHOLD,
        debt_limit: DRIVER_DEBT_LIMIT,
      };

      console.log("[smart-collection] daily report", JSON.stringify(report));
      return ok(res, { report });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

router.patch(
  "/provider-debts/:id/collect",
  requireAuth,
  requireRole("admin"),
  requireAdminPermission("finance"),
  async (req, res) => {
    try {
      const sb = createServiceClient();
      if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
      const id = String(req.params.id || "").trim();
      const note = String(req.body?.note || "").trim().slice(0, 500);
      const now = new Date().toISOString();
      const { data, error } = await sb
        .from("provider_commission_debts")
        .update({
          status: "collected",
          collected_at: now,
          collected_note: note || null,
          updated_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) return fail(res, error.message, 400);
      if (data && data.booking_id) {
        await sb
          .from("service_bookings")
          .update({
            commission_settled: true,
            commission_due: false,
            commission_paid_at: now,
            updated_at: now,
          })
          .eq("id", data.booking_id);
      }
      return ok(res, { debt: data });
    } catch (e) {
      return fail(res, e.message || String(e), 500);
    }
  }
);

module.exports = router;
