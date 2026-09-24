/**
 * رقم تسجيل المتجر يبقى حساب متجر، والاسم الظاهر هو اسم المتجر الذي أُدخل معه.
 */
const {
  canonicalPhoneDigits,
  phoneLookupVariants,
  phonesEquivalent,
  findUserByPhoneResilient,
} = require("../utils/userPhoneLookup");

const STORE_KEEP_ROLES = new Set(["store", "merchant", "restaurant"]);
const PROTECTED_ROLES = new Set(["admin", "blocked", "driver", "service"]);

function rankStoreRow(row) {
  const st = String((row && row.status) || "").toLowerCase();
  if (st === "approved") return 0;
  if (st === "pending" || st === "needs_info") return 1;
  return 9;
}

function storeDisplayName(store) {
  return String((store && store.name) || "").trim().slice(0, 200);
}

/**
 * حقول users التي تُكتب لربط الجوال بالمتجر.
 * null = لا تغيّر الدور (حساب محمي).
 */
function buildStoreOwnerUserPatch(existing, store) {
  const storeStatus = String((store && store.status) || "").toLowerCase();
  if (storeStatus === "rejected") return null;
  const role = String((existing && existing.role) || "").toLowerCase();
  const status = String((existing && existing.status) || "").toLowerCase();
  if (PROTECTED_ROLES.has(role) || status === "blocked") return null;

  const name = storeDisplayName(store);
  const patch = {};
  if (!existing || !role || role === "customer" || role === "user") patch.role = "store";
  const keepsStoreName = patch.role === "store" || STORE_KEEP_ROLES.has(role);
  if (name && keepsStoreName) patch.name = name;
  if (storeStatus === "approved") patch.status = "active";
  else if (storeStatus === "pending" || storeStatus === "needs_info") patch.status = "pending";
  if (!Object.keys(patch).length) return null;
  return patch;
}

async function findStoreByOwnerPhone(sb, digits) {
  if (!sb) return null;
  const variants = phoneLookupVariants(digits);
  if (!variants.length) return null;
  const cols = "id, name, phone, status, type";
  let rows = [];
  const listed = await sb.from("stores").select(cols).in("phone", variants).limit(8);
  if (!listed.error && Array.isArray(listed.data)) rows = listed.data;
  else if (listed.error) {
    console.warn("[storeOwnerAccount] lookup:", listed.error.message || listed.error);
  }
  if (!rows.length) {
    const canonical = canonicalPhoneDigits(digits);
    if (!/^9665\d{8}$/.test(canonical)) return null;
    const tail = canonical.slice(-9);
    const fuzzy = await sb.from("stores").select(cols).ilike("phone", `%${tail}`).limit(20);
    if (fuzzy.error) {
      console.warn("[storeOwnerAccount] lookup fuzzy:", fuzzy.error.message || fuzzy.error);
      return null;
    }
    rows = (Array.isArray(fuzzy.data) ? fuzzy.data : []).filter((row) =>
      phonesEquivalent(row.phone, canonical)
    );
  }
  if (!rows.length) return null;
  rows.sort((a, b) => rankStoreRow(a) - rankStoreRow(b));
  return rankStoreRow(rows[0]) < 9 ? rows[0] : null;
}

async function writeUserRow(sb, existing, patch) {
  const now = new Date().toISOString();
  const row = { ...patch, updated_at: now };
  if (existing && existing.id) {
    let res = await sb.from("users").update(row).eq("id", existing.id).select("id, role, status, phone, name").single();
    if (res.error && /status|name|column|schema cache/i.test(String(res.error.message || ""))) {
      const slim = { updated_at: now };
      if (patch.role) slim.role = patch.role;
      res = await sb.from("users").update(slim).eq("id", existing.id).select("id, role, status, phone, name").single();
    }
    if (res.error) return { user: { ...existing, ...patch }, error: res.error };
    return { user: res.data || { ...existing, ...patch }, error: null };
  }
  const phone = canonicalPhoneDigits(patch.phone || existing?.phone);
  const insert = { ...row, phone };
  let res = await sb.from("users").insert(insert).select("id, role, status, phone, name").single();
  if (res.error && /status|column|schema cache/i.test(String(res.error.message || ""))) {
    const slim = { phone, role: patch.role || "store", updated_at: now };
    if (patch.name) slim.name = patch.name;
    res = await sb.from("users").insert(slim).select("id, role, status, phone, name").single();
  }
  if (res.error) return { user: null, error: res.error };
  return { user: res.data, error: null };
}

async function linkOwner(sb, storeId, userId) {
  if (!storeId || !userId) return;
  const up = await sb
    .from("stores")
    .update({ owner_user_id: userId, updated_at: new Date().toISOString() })
    .eq("id", storeId);
  if (up.error && !/owner_user_id|column|schema cache/i.test(String(up.error.message || ""))) {
    console.warn("[storeOwnerAccount] owner link:", up.error.message || up.error);
  }
}

/**
 * ينشئ أو يحدّث حساب الجوال ليبقى متجراً باسم المتجر، ويربط stores.owner_user_id.
 */
async function bindStoreOwnerAccount(sb, store) {
  if (!sb || !store || !store.id) return { user: null };
  const phone = canonicalPhoneDigits(store.phone);
  if (!phone) return { user: null };
  const found = await findUserByPhoneResilient(sb, phone);
  const existing = found.data || null;
  const role = String((existing && existing.role) || "").toLowerCase();
  const status = String((existing && existing.status) || "").toLowerCase();
  if (role === "blocked" || status === "blocked") return { user: existing, blocked: true };

  const patch = buildStoreOwnerUserPatch(existing, store);
  if (!patch) {
    if (existing && existing.id) await linkOwner(sb, store.id, existing.id);
    return { user: existing };
  }
  const written = await writeUserRow(sb, existing, { ...patch, phone });
  if (written.error) {
    console.warn("[storeOwnerAccount] user write:", written.error.message || written.error);
  }
  const user = written.user;
  if (user && user.id) await linkOwner(sb, store.id, user.id);
  return { user, error: written.error || null };
}

module.exports = {
  buildStoreOwnerUserPatch,
  findStoreByOwnerPhone,
  bindStoreOwnerAccount,
  storeDisplayName,
};
