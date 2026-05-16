/**
 * دفتر عمولة COD للمندوبين — driver_ledger / driver_wallets
 * يتطلب: shared/migration_driver_commission_ledger.sql
 */

const { logger } = require("../utils/logger");

const DRIVER_DEBT_LIMIT = (() => {
  const n = Number(process.env.DRIVER_COMMISSION_DEBT_LIMIT || process.env.ERVENOW_DRIVER_DEBT_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 300;
})();

const COD_PAYMENT_METHODS = new Set(["cash", "cash_on_delivery", "cod", "cod_payment"]);

function isCodOrder(order) {
  const pm = String(order?.payment_method || "")
    .trim()
    .toLowerCase();
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
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 */
async function applyDriverCommissionOnDelivered(sb, orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return { ok: false, reason: "missing_order_id" };
  try {
    return await rpcResult(sb, "driver_ledger_apply_commission_on_delivered", { p_order_id: oid });
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
  isCodOrder,
  isDebtLimitError,
  isDriverLedgerTableMissing,
  generateReceiptReference,
  roundCollectAmount,
  applyDriverCommissionOnDelivered,
  getDriverCommissionBalance,
  assertDriverCanAcceptOrders,
  collectDriverCommission,
};
