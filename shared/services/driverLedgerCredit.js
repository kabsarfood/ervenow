/**
 * إيداع أجر المندوب عند التسليم — ledger_only (ervenow_ledger_credit / :earning).
 */

const { logger } = require("../utils/logger");
const { round2 } = require("../utils/operationalWallet");

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * @param {object} order
 * @returns {number}
 */
function resolveDriverEarningAmount(order) {
  const o = asObject(order);
  const data = asObject(o.data);
  const breakdown = asObject(o.breakdown);

  const direct = Number(o.driver_earning);
  if (Number.isFinite(direct) && direct > 0) return round2(direct);

  const fromData = Number(data.driver_earning ?? data.driverEarning);
  if (Number.isFinite(fromData) && fromData > 0) return round2(fromData);

  const deliveryFee = Number(o.delivery_fee ?? data.delivery_fee ?? breakdown.delivery_fee);
  const platformFee = Number(o.platform_fee ?? o.platform_commission ?? data.platform_fee ?? 0);

  if (Number.isFinite(deliveryFee) && deliveryFee > 0) {
    const net = round2(deliveryFee - (Number.isFinite(platformFee) && platformFee > 0 && platformFee < deliveryFee ? platformFee : 0));
    if (net > 0) return net;
    return round2(deliveryFee);
  }

  return NaN;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order
 * @param {object} [settlementRow]
 * @param {string} [context]
 */
async function creditDriverOnDelivered(sb, order, settlementRow = {}, context = "delivered") {
  const orderId = order?.id != null ? String(order.id).trim() : "";
  const driverId = order?.driver_id != null ? String(order.driver_id).trim() : "";

  if (!sb || !orderId) {
    return { ok: false, reason: "missing_order" };
  }
  if (!driverId) {
    return { ok: true, skipped: true, reason: "missing_driver_id" };
  }

  const settledDriver = Number(settlementRow.driver);
  if (
    (settlementRow.ok === true || settlementRow.ok === "true") &&
    Number.isFinite(settledDriver) &&
    settledDriver > 0
  ) {
    return { ok: true, reason: "settled_via_rpc", driver: settledDriver };
  }

  const amount = resolveDriverEarningAmount(order);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: true, skipped: true, reason: "missing_driver_earning" };
  }

  try {
    const { data, error } = await sb.rpc("ervenow_ledger_credit", {
      p_user_id: driverId,
      p_amount: amount,
      p_reference: orderId,
      p_role: "driver",
      p_reference_suffix: "earning",
    });

    if (error) {
      const msg = String(error.message || error);
      if (/does not exist|schema cache|function.*not found/i.test(msg)) {
        logger.warn({ orderId, context }, "[driverLedgerCredit] migration missing");
        return { ok: false, reason: "migration_missing", detail: msg };
      }
      logger.warn({ orderId, driverId, err: msg, context }, "[driverLedgerCredit] rpc error");
      return { ok: false, reason: "rpc_error", detail: msg };
    }

    const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    if (row.ok === true || row.ok === "true" || row.reason === "duplicate") {
      return { ...row, amount };
    }
    logger.warn({ orderId, result: row, context }, "[driverLedgerCredit] not credited");
    return row;
  } catch (e) {
    const msg = e && (e.message || String(e));
    logger.warn({ orderId, err: msg, context }, "[driverLedgerCredit] exception");
    return { ok: false, reason: "exception", detail: msg };
  }
}

module.exports = { creditDriverOnDelivered, resolveDriverEarningAmount };
