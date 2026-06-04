/**
 * تسوية مالية عند التسليم — ledger (ervenow_ledger_settle_delivered_order) + إيداع احتياطي للمندوب.
 */

const { getOrderProviderId } = require("../utils/orderProviderId");
const { logger } = require("../utils/logger");
const { SETTLEMENT_KINDS, tryClaimSettlement } = require("./settlementGuard");
const { creditDriverOnDelivered } = require("./driverLedgerCredit");
const { creditStoreMerchantOnDelivered } = require("./storeMerchantLedgerCredit");

function parseRpcRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function orderTotalAmount(order) {
  const raw = order?.total_amount ?? order?.order_total;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function isMigrationMissingError(msg) {
  return /does not exist|schema cache|function.*not found/i.test(String(msg || ""));
}

/**
 * محفظة المنصة مطلوبة لـ ervenow_ledger_settle_delivered_order — نُنشئها إن غابت.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function ensurePlatformLedgerWallet(sb) {
  if (!sb) return { ok: false, reason: "missing_client" };
  try {
    const { data: existing, error: selErr } = await sb
      .from("ervenow_ledger_wallets")
      .select("id")
      .eq("is_platform", true)
      .limit(1)
      .maybeSingle();

    if (selErr) {
      if (isMigrationMissingError(selErr.message)) {
        return { ok: false, reason: "migration_missing", detail: selErr.message };
      }
      throw selErr;
    }
    if (existing?.id) return { ok: true, wallet_id: existing.id };

    const { data: inserted, error: insErr } = await sb
      .from("ervenow_ledger_wallets")
      .insert({ user_id: null, role: "platform", is_platform: true, balance: 0, currency: "SAR" })
      .select("id")
      .maybeSingle();

    if (insErr) {
      if (/unique|duplicate|23505/i.test(String(insErr.message || ""))) {
        const { data: again } = await sb
          .from("ervenow_ledger_wallets")
          .select("id")
          .eq("is_platform", true)
          .limit(1)
          .maybeSingle();
        if (again?.id) return { ok: true, wallet_id: again.id };
      }
      if (isMigrationMissingError(insErr.message)) {
        return { ok: false, reason: "migration_missing", detail: insErr.message };
      }
      throw insErr;
    }
    return { ok: true, wallet_id: inserted?.id || null, created: true };
  } catch (e) {
    const msg = e && (e.message || String(e));
    if (isMigrationMissingError(msg)) {
      return { ok: false, reason: "migration_missing", detail: msg };
    }
    logger.warn({ err: msg }, "[deliveredFinancialSettlement] ensurePlatformLedgerWallet");
    return { ok: false, reason: "exception", detail: msg };
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 * @param {string} [context]
 */
async function callLedgerSettleDeliveredOrder(sb, orderId, context) {
  const platform = await ensurePlatformLedgerWallet(sb);
  if (!platform.ok && platform.reason === "migration_missing") {
    return { ok: false, reason: "migration_missing", detail: platform.detail };
  }

  try {
    const { data, error } = await sb.rpc("ervenow_ledger_settle_delivered_order", {
      p_order_id: orderId,
    });
    if (error) {
      const msg = String(error.message || error);
      if (isMigrationMissingError(msg)) {
        logger.warn({ orderId, context }, "[deliveredFinancialSettlement] ledger migration missing");
        return { ok: false, reason: "migration_missing", detail: msg };
      }
      if (/platform_wallet_missing/i.test(msg)) {
        logger.warn({ orderId, context }, "[deliveredFinancialSettlement] platform wallet missing after ensure");
        return { ok: false, reason: "platform_wallet_missing", detail: msg };
      }
      logger.warn({ orderId, err: msg, context }, "[deliveredFinancialSettlement] settle rpc error");
      return { ok: false, reason: "rpc_error", detail: msg };
    }
    return parseRpcRow(data);
  } catch (e) {
    const msg = e && (e.message || String(e));
    logger.warn({ orderId, err: msg, context }, "[deliveredFinancialSettlement] settle exception");
    return { ok: false, reason: "exception", detail: msg };
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order — صف orders بعد delivered
 * @param {string} [context]
 */
async function runDeliveredFinancialSettlement(sb, order, context = "unified:delivered") {
  const orderId = order?.id != null ? String(order.id).trim() : "";
  if (!sb || !orderId) {
    return {
      settlement: { ok: false, reason: "missing_order" },
      provider_credit: null,
      driver_credit: null,
      merchant_credit: null,
    };
  }

  await tryClaimSettlement(sb, orderId, "order", SETTLEMENT_KINDS.LEDGER_DELIVERED, { context });

  /* دائماً نستدعي RPC — idempotent عبر reference_id؛ claim قد يمنع إعادة المحاولة خطأً */
  const settlementRow = await callLedgerSettleDeliveredOrder(sb, orderId, context);

  const driverCreditRow = await creditDriverOnDelivered(sb, order, settlementRow, context);

  if (
    driverCreditRow &&
    driverCreditRow.ok !== true &&
    driverCreditRow.ok !== "true" &&
    !driverCreditRow.skipped &&
    driverCreditRow.reason !== "settled_via_rpc"
  ) {
    logger.warn({ orderId, result: driverCreditRow, context }, "[deliveredFinancialSettlement] driver credit");
  }

  let providerCreditRow = null;
  const providerId = getOrderProviderId(order);
  if (providerId) {
    const amount = orderTotalAmount(order);
    if (Number.isFinite(amount) && amount > 0) {
      try {
        const { data, error } = await sb.rpc("ervenow_ledger_credit", {
          p_user_id: providerId,
          p_amount: amount,
          p_reference: orderId,
          p_role: "service",
          p_reference_suffix: "provider_credit",
        });
        if (error) {
          const msg = String(error.message || error);
          logger.warn({ orderId, providerId, err: msg }, "[deliveredFinancialSettlement] provider credit");
          providerCreditRow = { ok: false, reason: "rpc_error", detail: msg };
        } else {
          providerCreditRow = parseRpcRow(data);
        }
      } catch (e) {
        providerCreditRow = { ok: false, reason: "exception", detail: e && (e.message || String(e)) };
      }
    } else {
      providerCreditRow = { ok: true, skipped: true, reason: "missing_total_amount" };
    }
  }

  const merchantCreditRow = await creditStoreMerchantOnDelivered(sb, order, settlementRow);
  if (
    merchantCreditRow &&
    merchantCreditRow.ok !== true &&
    merchantCreditRow.ok !== "true" &&
    !merchantCreditRow.skipped
  ) {
    logger.warn({ orderId, result: merchantCreditRow, context }, "[deliveredFinancialSettlement] merchant credit");
  }

  return {
    settlement: settlementRow,
    provider_credit: providerCreditRow,
    driver_credit: driverCreditRow,
    merchant_credit: merchantCreditRow,
  };
}

module.exports = {
  runDeliveredFinancialSettlement,
  ensurePlatformLedgerWallet,
  callLedgerSettleDeliveredOrder,
};
