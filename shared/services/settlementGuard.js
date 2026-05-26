/**
 * Idempotent settlement guard — settlement_log (migration_database_refactor_05).
 * Ledger-only: claim required (no settlement without log).
 */

const { isLedgerOnlyMode } = require("../utils/financeMode");

const SETTLEMENT_KINDS = {
  LEDGER_DELIVERED: "ledger_delivered",
  LEDGER_SERVICE: "ledger_service",
  DRIVER_COD_COMMISSION: "driver_cod_commission",
  OPERATIONAL_EARNING: "operational_earning",
  FINANCE_WALLETS_SETTLE: "finance_wallets_settle",
};

function isMissingSettlementSchema(err) {
  const msg = String(err?.message || err || "");
  return /settlement_log|does not exist|schema cache|function.*not found|PGRST202/i.test(msg);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} entityId
 * @param {'order'|'service_booking'|'withdraw_request'|'other'} entityType
 * @param {string} settlementKind
 * @param {object} [metadata]
 * @returns {Promise<boolean>} true = proceed with settlement
 */
async function tryClaimSettlement(sb, entityId, entityType, settlementKind, metadata = {}) {
  const eid = String(entityId || "").trim();
  if (!eid || !sb) {
    if (isLedgerOnlyMode()) return false;
    return true;
  }

  try {
    const { data, error } = await sb.rpc("settlement_log_try_claim", {
      p_entity_id: eid,
      p_entity_type: entityType,
      p_settlement_kind: settlementKind,
      p_metadata: metadata,
    });
    if (error) {
      if (isMissingSettlementSchema(error)) {
        console.warn(
          "[settlement_guard] settlement_log missing — proceed (ledger reference_id is idempotent); run migration_database_refactor_05_settlement_log.sql"
        );
        return true;
      }
      console.warn("[settlement_guard] claim error:", error.message || error);
      return isLedgerOnlyMode() ? false : true;
    }
    return data === true;
  } catch (e) {
    if (isMissingSettlementSchema(e)) {
      console.warn(
        "[settlement_guard] settlement_log missing — proceed (ledger reference_id is idempotent)"
      );
      return true;
    }
    console.warn("[settlement_guard] claim exception:", e.message || e);
    return isLedgerOnlyMode() ? false : true;
  }
}

module.exports = { SETTLEMENT_KINDS, tryClaimSettlement, isMissingSettlementSchema };
