/**
 * إدراج أحداث تدقيق في public.ervenow_audit_events (بعد تنفيذ migration_ervenow_audit_events.sql).
 * لا يُرمى للأعلى عند غياب الجدول — يُسجَّل تحذير فقط (لا كسر للمسار الحرج).
 */

const { logger } = require("../utils/logger");

function isAuditTableMissingError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /ervenow_audit_events|does not exist|schema cache|relation/i.test(msg);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} row
 */
async function insertAuditEvent(sb, row) {
  if (!sb || !row || typeof row !== "object") return { ok: false, skipped: true };
  const payload = {
    scope: String(row.scope || "unknown").slice(0, 120),
    action: String(row.action || "unknown").slice(0, 120),
    actor_type: row.actor_type != null ? String(row.actor_type).slice(0, 64) : null,
    actor_id: row.actor_id != null ? String(row.actor_id) : null,
    subject_type: row.subject_type != null ? String(row.subject_type).slice(0, 64) : null,
    subject_id: row.subject_id != null ? String(row.subject_id).slice(0, 200) : null,
    ip: row.ip != null ? String(row.ip).slice(0, 128) : null,
    user_agent: row.user_agent != null ? String(row.user_agent).slice(0, 512) : null,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    payload_before: row.payload_before,
    payload_after: row.payload_after,
  };
  try {
    const { error } = await sb.from("ervenow_audit_events").insert(payload);
    if (error) {
      if (isAuditTableMissingError(error)) {
        logger.warn({ err: error.message }, "[audit] ervenow_audit_events missing — run migration_ervenow_audit_events.sql");
        return { ok: false, skipped: true };
      }
      logger.error({ err: error.message }, "[audit] insert failed");
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    logger.error({ err: e && e.message }, "[audit] insert exception");
    return { ok: false, error: e };
  }
}

module.exports = { insertAuditEvent, isAuditTableMissingError };
