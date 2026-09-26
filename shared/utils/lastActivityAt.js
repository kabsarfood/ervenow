/** عرض آخر نشاط: الحضور أولاً، ثم وقت التعديل، ثم وقت الإنشاء. */
function lastActivityAt(row) {
  if (!row || typeof row !== "object") return null;
  const seen = row.last_seen_at;
  if (seen != null && String(seen).trim()) return seen;
  const updated = row.updated_at;
  if (updated != null && String(updated).trim()) return updated;
  const created = row.created_at;
  if (created != null && String(created).trim()) return created;
  return null;
}

module.exports = { lastActivityAt };
