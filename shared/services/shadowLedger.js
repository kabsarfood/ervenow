/**
 * Shadow Ledger (Phase 1) — تسجيل موازٍ في ervenow_ledger_* دون تأثير على الأنظمة الحالية.
 * أخطاء RPC تُسجَّل فقط ولا تُرمى للأعلى حتى لا تكسر مسارات التسليم/checkout.
 */

function isMigrationMissingError(msg) {
  return /does not exist|schema cache|function.*not found/i.test(String(msg || ""));
}

function parseRpcRow(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} id
 * @param {{ context?: string, type?: 'order'|'service' }} [meta]
 */
async function shadowLedgerSettleDeliveredOrder(sb, id, meta = {}) {
  const entityId = String(id || "").trim();
  if (!entityId || !sb) {
    console.log("[ledger] settlement skip — missing id or client");
    return { ok: false, reason: "missing_id" };
  }

  const type = String(meta.type || "order").toLowerCase();
  const ctx = meta.context ? ` (${meta.context})` : "";

  try {
    let data;
    let error;

    if (type === "service") {
      ({ data, error } = await sb.rpc("ervenow_ledger_settle_service_booking", {
        p_booking_id: entityId,
      }));
    } else {
      ({ data, error } = await sb.rpc("ervenow_ledger_settle_delivered_order", {
        p_order_id: entityId,
      }));
    }

    if (error) {
      const msg = String(error.message || error);
      if (isMigrationMissingError(msg)) {
        console.log("[ledger] settlement skip — migration missing", entityId, ctx);
        return { ok: false, reason: "migration_missing", detail: msg };
      }
      console.error("[ledger] settlement error:", entityId, msg);
      return { ok: false, reason: "rpc_error", detail: msg };
    }

    const row = parseRpcRow(data);
    if (row.ok === true || row.ok === "true") {
      console.log("[ledger] settlement done:", entityId);
    } else {
      console.log("[ledger] settlement skip:", entityId, row.reason || "unknown", ctx.trim());
    }
    return row;
  } catch (e) {
    console.error("[ledger] settlement error:", entityId, e && (e.message || String(e)));
    return { ok: false, reason: "exception", detail: String(e && (e.message || e)) };
  }
}

module.exports = { shadowLedgerSettleDeliveredOrder };
