/**
 * دفتر عمولة COD للمندوبين — driver_ledger / driver_wallets
 * يتطلب: shared/migration_driver_commission_ledger.sql
 *         shared/migration_driver_commission_robust.sql (موصى به)
 */

const { logger } = require("../utils/logger");

const DRIVER_DEBT_LIMIT = (() => {
  const n = Number(process.env.DRIVER_COMMISSION_DEBT_LIMIT || process.env.ERVENOW_DRIVER_DEBT_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 300;
})();

/** أنواع الدفع التي تُسجَّل عليها عمولة COD */
const COD_PAYMENT_METHODS = new Set([
  "cash",
  "cod",
  "cash_on_delivery",
  "cod_payment",
  "delivery",
]);

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * COALESCE(column, data.paymentMethod, data.payment_method, breakdown…)
 * @param {object} order
 * @returns {string}
 */
function resolveOrderPaymentMethod(order) {
  const o = asObject(order);
  const data = asObject(o.data);
  const breakdown = asObject(o.breakdown);
  return String(
    o.payment_method ||
      data.paymentMethod ||
      data.payment_method ||
      breakdown.paymentMethod ||
      breakdown.payment_method ||
      ""
  )
    .trim()
    .toLowerCase();
}

/**
 * مبلغ الفاتورة — أعمدة orders ثم data JSON
 * @param {object} order
 * @returns {number}
 */
function resolveOrderBillableAmount(order) {
  const o = asObject(order);
  const data = asObject(o.data);

  const twv = Number(o.total_with_vat);
  if (Number.isFinite(twv) && twv > 0) return Math.round(twv * 100) / 100;

  const composed =
    (Number(o.order_total) || 0) + (Number(o.delivery_fee) || 0) + (Number(o.vat_amount) || 0);
  if (Number.isFinite(composed) && composed > 0) return Math.round(composed * 100) / 100;

  const ta = Number(o.total_amount);
  if (Number.isFinite(ta) && ta > 0) return Math.round(ta * 100) / 100;

  const fromData = Number(data.total ?? data.total_amount ?? data.totalWithVat);
  if (Number.isFinite(fromData) && fromData > 0) return Math.round(fromData * 100) / 100;

  const pf = Number(o.platform_fee);
  if (Number.isFinite(pf) && pf > 0) return Math.round(pf * 100) / 100;

  const ot = Number(o.order_total);
  if (Number.isFinite(ot) && ot > 0) return Math.round(ot * 100) / 100;

  return 0;
}

function isCodOrder(order) {
  const pm = resolveOrderPaymentMethod(order);
  if (!pm) return false;
  return COD_PAYMENT_METHODS.has(pm);
}

function isDebtLimitError(err) {
  return err && (err.code === "DRIVER_DEBT_LIMIT" || err.reason === "debt_limit");
}

async function rpcResult(sb, fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const e = new Error(error.message || String(error));
    e.details = error;
    throw e;
  }
  const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  return row;
}

/**
 * استدعاء RPC عمولة COD — مع حماية وتسجيل (ربط مباشر)
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 * @param {{ driverId?: string, total?: number, label?: string }} [opts]
 */
async function invokeDriverLedgerCommissionRpc(sb, orderId, opts = {}) {
  const oid = String(orderId || "").trim();
  const label = String(opts.label || "delivery");
  const driverId = String(opts.driverId || opts.driver_id || "").trim();
  const total = Number(opts.total);

  if (!oid) {
    console.log(`[commission:${label}] skip — missing order id`);
    return { ok: false, reason: "missing_order_id" };
  }
  if (!driverId) {
    console.log(`[commission:${label}] skip — no driver_id`, { orderId: oid });
    return { ok: false, reason: "no_driver", skipped: true };
  }
  if (!Number.isFinite(total) || total <= 0) {
    console.log(`[commission:${label}] skip — zero total`, { orderId: oid });
    return { ok: false, reason: "zero_total", skipped: true };
  }

  try {
    const { data, error } = await sb.rpc("driver_ledger_apply_commission_on_delivered", {
      p_order_id: oid,
    });
    if (error) throw error;
    const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    if (row.ok === true && row.reason === "commission_recorded") {
      console.log(`[commission:${label}] success`, { orderId: oid, amount: row.amount, driverId: row.driver_id });
    } else {
      console.log(`[commission:${label}] rpc result`, { orderId: oid, result: row });
    }
    return row;
  } catch (e) {
    console.error("Commission error:", e.message || String(e));
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 * @param {object} [orderRow] صف الطلب إن وُجد (يتجنب round-trip)
 */
async function applyDriverCommissionOnDelivered(sb, orderId, orderRow) {
  const oid = String(orderId || "").trim();
  if (!oid) return { ok: false, reason: "missing_order_id" };

  let order = orderRow;
  if (!order || typeof order !== "object") {
    try {
      const { data, error } = await sb.from("orders").select("*").eq("id", oid).maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, reason: "order_not_found" };
      order = data;
    } catch (fetchErr) {
      if (/does not exist|42883|driver_ledger/i.test(String(fetchErr.message || ""))) {
        logger.warn("[driver_ledger] orders fetch skip — migration?");
        return { ok: false, reason: "order_fetch_failed" };
      }
      throw fetchErr;
    }
  }

  if (!order.driver_id) {
    return { ok: false, reason: "no_driver", skipped: true };
  }

  const status = String(order.delivery_status || order.status || "").toLowerCase();
  if (status !== "delivered") {
    return { ok: false, reason: "not_delivered", status };
  }

  const billable = resolveOrderBillableAmount(order);
  if (!Number.isFinite(billable) || billable <= 0) {
    return { ok: true, reason: "zero_billable", skipped: true, amount: 0 };
  }

  if (!isCodOrder(order)) {
    return {
      ok: true,
      reason: "not_cod",
      skipped: true,
      payment_method: resolveOrderPaymentMethod(order),
    };
  }

  try {
    return await invokeDriverLedgerCommissionRpc(sb, oid, {
      driverId: order.driver_id,
      total: billable,
      label: "delivery",
    });
  } catch (err) {
    if (/does not exist|42883|driver_ledger/i.test(String(err.message || ""))) {
      logger.warn("[driver_ledger] migration not applied — skip commission ledger");
      return { ok: false, reason: "migration_missing" };
    }
    throw err;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} driverUserId users.id
 */
async function getDriverCommissionBalance(sb, driverUserId) {
  const id = String(driverUserId || "").trim();
  if (!id) return 0;
  try {
    const { data, error } = await sb.rpc("driver_ledger_get_balance", { p_driver_id: id });
    if (error) {
      if (/does not exist|42883/i.test(String(error.message || ""))) return 0;
      throw error;
    }
    const n = Number(data);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  } catch (err) {
    if (/does not exist|42883/i.test(String(err.message || ""))) return 0;
    throw err;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} driverUserId
 * @returns {{ allowed: boolean, balance: number, limit: number, debt_blocked: boolean }}
 */
async function assertDriverCanAcceptOrders(sb, driverUserId) {
  const balance = await getDriverCommissionBalance(sb, driverUserId);
  const blocked = balance > DRIVER_DEBT_LIMIT;
  if (blocked) {
    const err = new Error(
      `تجاوزت حد عمولة COD المستحقة (${balance.toFixed(2)} ر.س). الحد الأقصى ${DRIVER_DEBT_LIMIT} ر.س — راجع الإدارة للتحصيل.`
    );
    err.code = "DRIVER_DEBT_LIMIT";
    err.reason = "debt_limit";
    err.balance = balance;
    err.limit = DRIVER_DEBT_LIMIT;
    throw err;
  }
  return { allowed: true, balance, limit: DRIVER_DEBT_LIMIT, debt_blocked: false };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} driverUserId
 * @param {number} amount
 * @param {object} [meta]
 */
async function collectDriverCommission(sb, driverUserId, amount, meta) {
  const id = String(driverUserId || "").trim();
  const amt = Number(amount);
  if (!id) throw new Error("driver_id required");
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("amount must be positive");
  return rpcResult(sb, "driver_ledger_collect", {
    p_driver_id: id,
    p_amount: amt,
    p_meta: meta && typeof meta === "object" ? meta : {},
  });
}

function isDriverLedgerTableMissing(err) {
  const msg = String(err?.message || err?.details?.message || "");
  return /does not exist|relation.*driver_ledger|relation.*driver_wallets|schema cache/i.test(msg);
}

/** مرجع إيصال تحصيل — يُحفظ في driver_ledger.meta.receipt_reference */
function generateReceiptReference() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCV-${date}-${time}-${rand}`;
}

function roundCollectAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

module.exports = {
  DRIVER_DEBT_LIMIT,
  COD_PAYMENT_METHODS,
  resolveOrderPaymentMethod,
  resolveOrderBillableAmount,
  isCodOrder,
  isDebtLimitError,
  isDriverLedgerTableMissing,
  generateReceiptReference,
  roundCollectAmount,
  applyDriverCommissionOnDelivered,
  invokeDriverLedgerCommissionRpc,
  getDriverCommissionBalance,
  assertDriverCanAcceptOrders,
  collectDriverCommission,
};
