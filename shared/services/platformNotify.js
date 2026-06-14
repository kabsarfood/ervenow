/**
 * إشعارات داخل التطبيق — متاجر · أدمن · مزودو خدمات
 */
const { createNotification } = require("./notificationService");
const { findUserByPhone } = require("../utils/userPhoneLookup");
const { phoneLookupVariants } = require("../utils/userPhoneLookup");
const { logger } = require("../utils/logger");

let adminIdsCache = { at: 0, ids: [] };
const ADMIN_CACHE_MS = 60_000;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string|{ id?: string, phone?: string, owner_user_id?: string }} storeIdOrRow
 */
async function resolveStoreMerchantUserId(sb, storeIdOrRow) {
  if (!sb) return null;
  let storeRow = storeIdOrRow;
  if (!storeRow || typeof storeRow === "string" || typeof storeRow === "number") {
    const sid = String(storeIdOrRow || "").trim();
    if (!sid) return null;
    const { data } = await sb
      .from("stores")
      .select("id, phone, owner_user_id")
      .eq("id", sid)
      .maybeSingle();
    storeRow = data;
  }
  if (!storeRow) return null;
  if (storeRow.owner_user_id) return String(storeRow.owner_user_id).trim();

  const phone = storeRow.phone;
  if (!phone) return null;
  const found = await findUserByPhone(sb, phone, "id, role, phone");
  return found && found.data && found.data.id ? String(found.data.id) : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listAdminUserIds(sb) {
  const now = Date.now();
  if (adminIdsCache.ids.length && now - adminIdsCache.at < ADMIN_CACHE_MS) {
    return adminIdsCache.ids;
  }
  const { data, error } = await sb.from("users").select("id").eq("role", "admin");
  if (error) throw error;
  const ids = (data || []).map((r) => String(r.id)).filter(Boolean);
  adminIdsCache = { at: now, ids };
  return ids;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function notifyStoreInApp(sb, input) {
  if (!sb || !input) return null;
  const merchantUserId =
    input.merchantUserId ||
    (input.storeId && (await resolveStoreMerchantUserId(sb, input.storeId))) ||
    (input.storeRow && (await resolveStoreMerchantUserId(sb, input.storeRow)));
  if (!merchantUserId) return null;
  return createNotification(sb, {
    recipient_type: "store",
    recipient_id: merchantUserId,
    title: input.title,
    message: input.message,
    type: input.type || "order",
    source: input.source || "store",
    payload: input.payload || {},
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function notifyAdminsInApp(sb, input) {
  if (!sb || !input) return [];
  let ids = [];
  try {
    ids = await listAdminUserIds(sb);
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, "[platformNotify] list admins failed");
    return [];
  }
  const out = [];
  for (const adminId of ids) {
    try {
      const row = await createNotification(sb, {
        recipient_type: "admin",
        recipient_id: adminId,
        title: input.title,
        message: input.message,
        type: input.type || "system",
        source: input.source || "admin",
        payload: input.payload || {},
      });
      out.push(row);
    } catch (e) {
      logger.warn({ err: e.message || String(e), adminId }, "[platformNotify] admin notify failed");
    }
  }
  return out;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function notifyProviderInApp(sb, input) {
  if (!sb || !input || !input.providerUserId) return null;
  return createNotification(sb, {
    recipient_type: "provider",
    recipient_id: String(input.providerUserId),
    title: input.title,
    message: input.message,
    type: input.type || "order",
    source: input.source || "delivery",
    payload: input.payload || {},
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order
 */
async function notifyStoreForOrderEvent(sb, order, title, message, extraPayload) {
  if (!order || !order.store_id) return null;
  return notifyStoreInApp(sb, {
    storeId: order.store_id,
    title,
    message,
    type: "order",
    source: "store",
    payload: Object.assign(
      {
        order_id: order.id,
        order_number: order.order_number || null,
        store_id: order.store_id || null,
        delivery_status: order.delivery_status || order.status || null,
      },
      extraPayload || {}
    ),
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order
 */
async function notifyAdminsForOrderEvent(sb, order, title, message) {
  return notifyAdminsInApp(sb, {
    title,
    message,
    type: "order",
    source: "ervenow",
    payload: {
      order_id: order && order.id,
      order_number: order && order.order_number,
      store_id: order && order.store_id,
      order_type: order && order.order_type,
      delivery_status: order && (order.delivery_status || order.status),
    },
  });
}

/**
 * انضمام socket لغرفة المتجر — بحث بالمالك ثم صيغ الجوال
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} userId
 */
async function resolveApprovedStoreIdForMerchantUser(sb, userId) {
  if (!sb || !userId) return null;
  const { data: byOwner } = await sb
    .from("stores")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  if (byOwner && byOwner.id) return String(byOwner.id);

  const { data: user } = await sb.from("users").select("phone").eq("id", userId).maybeSingle();
  if (!user || !user.phone) return null;
  const variants = phoneLookupVariants(user.phone);
  if (!variants.length) return null;
  const { data: stores } = await sb
    .from("stores")
    .select("id")
    .in("phone", variants)
    .eq("status", "approved")
    .limit(1);
  const st = Array.isArray(stores) ? stores[0] : stores;
  return st && st.id ? String(st.id) : null;
}

module.exports = {
  resolveStoreMerchantUserId,
  resolveApprovedStoreIdForMerchantUser,
  listAdminUserIds,
  notifyStoreInApp,
  notifyAdminsInApp,
  notifyProviderInApp,
  notifyStoreForOrderEvent,
  notifyAdminsForOrderEvent,
};
