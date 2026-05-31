/**
 * تحديث/قراءة users من لوحة الإدارة — بدون الاعتماد على users.name
 */
const { isMissingUsersColumnError } = require("./userPhoneLookup");

const SELECT_CORE = "id, phone, role, status";
const SELECT_MIN = "id, phone, role";

function isRetryableColumnError(err) {
  if (!err) return false;
  if (isMissingUsersColumnError(err)) return true;
  const msg = String(err.message || err.details || "");
  return /Could not find the|schema cache|column .* does not exist/i.test(msg);
}

async function fetchUserByIdResilient(sb, id) {
  for (const cols of [SELECT_CORE, SELECT_MIN]) {
    const { data, error } = await sb.from("users").select(cols).eq("id", id).maybeSingle();
    if (!error && data) return { data, error: null };
    if (error && !isRetryableColumnError(error)) return { data: null, error };
  }
  return { data: null, error: new Error("user not found") };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
async function patchUserByIdForAdmin(sb, id, patch) {
  const uid = String(id || "").trim();
  if (!uid || !sb) return { data: null, error: new Error("missing id") };

  const withTs = { ...patch, updated_at: new Date().toISOString() };
  const patchAttempts = [withTs, { ...patch }];
  const selectAttempts = [SELECT_CORE, SELECT_MIN];

  for (const p of patchAttempts) {
    for (const cols of selectAttempts) {
      const { data, error } = await sb.from("users").update(p).eq("id", uid).select(cols).maybeSingle();
      if (!error && data) {
        return {
          data: { ...data, status: patch.status != null ? patch.status : data.status },
          error: null,
        };
      }
      if (error && !isRetryableColumnError(error)) return { data: null, error };
    }
  }

  for (const p of patchAttempts) {
    const { error } = await sb.from("users").update(p).eq("id", uid);
    if (!error) {
      const fetched = await fetchUserByIdResilient(sb, uid);
      if (fetched.data) {
        return {
          data: { ...fetched.data, status: patch.status != null ? patch.status : fetched.data.status },
          error: null,
        };
      }
      return { data: { id: uid, status: patch.status, role: patch.role }, error: null };
    }
    if (!isRetryableColumnError(error)) return { data: null, error };
  }

  return { data: null, error: new Error("تعذّر تحديث الحساب") };
}

module.exports = {
  fetchUserByIdResilient,
  patchUserByIdForAdmin,
  SELECT_CORE,
  SELECT_MIN,
};
