/**
 * Idempotent settlement guard — settlement_log (migration_database_refactor_05).
 * FAIL CLOSED: claim RPC/DB error → do not settle.
 */

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
 * P1-03 FAIL CLOSED: any claim RPC/DB error → do not settle.
 * @returns {Promise<{ proceed: boolean, reason: string, detail?: string }>}
 */
async function claimSettlement(sb, entityId, entityType, settlementKind, metadata = {}) {
  const eid = String(entityId || "").trim();
  if (!eid || !sb) {
    return { proceed: false, reason: "missing_ids" };
  }

  try {
    const { data, error } = await sb.rpc("settlement_log_try_claim", {
      p_entity_id: eid,
      p_entity_type: entityType,
      p_settlement_kind: settlementKind,
      p_metadata: metadata,
    });
    if (error) {
      const detail = String(error.message || error);
      if (isMissingSettlementSchema(error)) {
        console.warn(
          "[settlement_guard] settlement_log missing — FAIL CLOSED; run migration_database_refactor_05_settlement_log.sql"
        );
        return { proceed: false, reason: "schema_missing", detail };
      }
      console.warn("[settlement_guard] claim error (fail closed):", detail);
      return { proceed: false, reason: "rpc_error", detail };
    }
    if (data === true) return { proceed: true, reason: "claimed" };
    return { proceed: false, reason: "already_claimed" };
  } catch (e) {
    const detail = e && (e.message || String(e));
    if (isMissingSettlementSchema(e)) {
      console.warn("[settlement_guard] settlement_log missing — FAIL CLOSED");
      return { proceed: false, reason: "schema_missing", detail };
    }
    console.warn("[settlement_guard] claim exception (fail closed):", detail);
    return { proceed: false, reason: "exception", detail };
  }
}

/** @returns {Promise<boolean>} true = proceed with settlement */
async function tryClaimSettlement(sb, entityId, entityType, settlementKind, metadata = {}) {
  const out = await claimSettlement(sb, entityId, entityType, settlementKind, metadata);
  return out.proceed === true;
}

async function releaseSettlementClaim(sb, entityId, entityType, settlementKind) {
  if (!sb || !entityId) return { ok: false, reason: "missing" };
  try {
    const { error } = await sb.rpc("settlement_log_release_claim", {
      p_entity_id: String(entityId),
      p_entity_type: entityType,
      p_settlement_kind: settlementKind,
    });
    if (error) {
      if (isMissingSettlementSchema(error)) return { ok: false, reason: "schema_missing" };
      return { ok: false, reason: "rpc_error", detail: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "exception", detail: e && e.message };
  }
}

module.exports = {
  SETTLEMENT_KINDS,
  tryClaimSettlement,
  claimSettlement,
  releaseSettlementClaim,
  isMissingSettlementSchema,
};
