/**
 * ذاكرة عملية لقراءات platform_settings.
 * أول طلب يقرأ القاعدة، ثم تُخدم النسخة حتى 45 ثانية أو حتى invalidate بعد الحفظ.
 */

const TTL_MS = 45 * 1000;
const rows = new Map();

function fresh(entry) {
  return entry && Date.now() - entry.at < TTL_MS;
}

function invalidatePlatformSettings(key) {
  if (key) rows.delete(String(key));
  else rows.clear();
}

async function readPlatformSetting(sb, key) {
  const id = String(key || "");
  const hit = rows.get(id);
  if (fresh(hit)) return hit.value;
  if (!sb || !id) return hit ? hit.value : null;
  try {
    const { data, error } = await sb.from("platform_settings").select("value").eq("key", id).maybeSingle();
    if (error) throw error;
    const value = data && data.value != null ? data.value : null;
    rows.set(id, { value: value, at: Date.now() });
    return value;
  } catch (e) {
    if (hit) return hit.value;
    throw e;
  }
}

async function readPlatformSettings(sb, keys) {
  const list = (keys || []).map(function (k) { return String(k); });
  const now = Date.now();
  const missing = list.filter(function (k) {
    return !fresh(rows.get(k));
  });
  if (sb && missing.length) {
    try {
      const { data, error } = await sb.from("platform_settings").select("key,value").in("key", missing);
      if (error) throw error;
      const seen = {};
      (data || []).forEach(function (row) {
        if (!row || !row.key) return;
        seen[row.key] = true;
        rows.set(String(row.key), { value: row.value, at: now });
      });
      missing.forEach(function (k) {
        if (!seen[k]) rows.set(k, { value: null, at: now });
      });
    } catch (e) {
      const anyFresh = list.some(function (k) { return rows.has(k); });
      if (!anyFresh) throw e;
    }
  }
  return list.map(function (k) {
    const entry = rows.get(k);
    return { key: k, value: entry ? entry.value : null };
  });
}

module.exports = {
  TTL_MS,
  invalidatePlatformSettings,
  readPlatformSetting,
  readPlatformSettings,
};
