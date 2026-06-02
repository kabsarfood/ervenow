const RECIPIENT_TYPES = new Set(["customer", "driver", "store", "provider", "admin"]);
const NOTIFICATION_TYPES = new Set([
  "order",
  "wallet",
  "payment",
  "account",
  "delivery",
  "system",
  "promotion",
]);
const NOTIFICATION_SOURCES = new Set(["ervenow", "wallet", "delivery", "store", "admin"]);
const { broadcastNotificationNew, roomForRecipient } = require("../lib/trackingSocket");

function normalizeText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

function normalizeRecipientType(value) {
  const t = normalizeText(value).toLowerCase();
  if (!RECIPIENT_TYPES.has(t)) {
    throw new Error("recipient_type invalid");
  }
  return t;
}

function normalizeNotificationType(value) {
  const t = normalizeText(value || "system", "system").toLowerCase();
  if (!NOTIFICATION_TYPES.has(t)) {
    throw new Error("type invalid");
  }
  return t;
}

function normalizeSource(value) {
  const s = normalizeText(value || "ervenow", "ervenow").toLowerCase();
  if (!NOTIFICATION_SOURCES.has(s)) {
    throw new Error("source invalid");
  }
  return s;
}

function normalizePayload(payload) {
  if (payload == null) return {};
  if (typeof payload === "object" && !Array.isArray(payload)) return payload;
  return {};
}

async function createNotification(sb, input) {
  if (!sb) throw new Error("supabase client is required");
  const title = normalizeText(input && input.title);
  const message = normalizeText(input && input.message);
  if (!title) throw new Error("title is required");
  if (!message) throw new Error("message is required");

  const row = {
    recipient_type: normalizeRecipientType(input && input.recipient_type),
    recipient_id: input && input.recipient_id ? String(input.recipient_id).trim() : null,
    title,
    message,
    type: normalizeNotificationType(input && input.type),
    source: normalizeSource(input && input.source),
    payload: normalizePayload(input && input.payload),
  };

  const { data, error } = await sb.from("notifications").insert(row).select("*").single();
  if (error) throw error;
  try {
    const room = roomForRecipient(data.recipient_type, data.recipient_id);
    if (room) {
      broadcastNotificationNew(room, {
        id: data.id,
        recipient_type: data.recipient_type,
        recipient_id: data.recipient_id,
        title: data.title,
        message: data.message,
        type: data.type,
        source: data.source,
        is_read: data.is_read,
        created_at: data.created_at,
      });
    }
  } catch (_) {
    /* non-blocking socket side effect */
  }
  return data;
}

async function markNotificationRead(sb, id, recipientType, recipientId) {
  if (!sb) throw new Error("supabase client is required");
  const notifId = normalizeText(id);
  if (!notifId) throw new Error("id is required");

  let q = sb
    .from("notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq("id", notifId);

  if (recipientType) q = q.eq("recipient_type", normalizeRecipientType(recipientType));
  if (recipientId) q = q.eq("recipient_id", String(recipientId).trim());

  const { data, error } = await q.select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

async function markAllNotificationsRead(sb, recipientType, recipientId) {
  if (!sb) throw new Error("supabase client is required");
  const rType = normalizeRecipientType(recipientType);
  const rId = normalizeText(recipientId);
  if (!rId) throw new Error("recipient_id is required");

  const { error } = await sb
    .from("notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq("recipient_type", rType)
    .eq("recipient_id", rId)
    .eq("is_read", false);
  if (error) throw error;

  const { count, error: cntErr } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_type", rType)
    .eq("recipient_id", rId)
    .eq("is_read", false);
  if (cntErr) throw cntErr;

  return { unread_count: Number(count || 0) };
}

async function getNotifications(sb, recipientType, recipientId, opts = {}) {
  if (!sb) throw new Error("supabase client is required");
  const rType = normalizeRecipientType(recipientType);
  const rId = normalizeText(recipientId);
  if (!rId) throw new Error("recipient_id is required");

  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
  let q = sb
    .from("notifications")
    .select("*")
    .eq("recipient_type", rType)
    .eq("recipient_id", rId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.unreadOnly === true) q = q.eq("is_read", false);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getUnreadCount(sb, recipientType, recipientId) {
  if (!sb) throw new Error("supabase client is required");
  const rType = normalizeRecipientType(recipientType);
  const rId = normalizeText(recipientId);
  if (!rId) throw new Error("recipient_id is required");

  const { count, error } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_type", rType)
    .eq("recipient_id", rId)
    .eq("is_read", false);
  if (error) throw error;
  return Number(count || 0);
}

module.exports = {
  RECIPIENT_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_SOURCES,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
  getNotifications,
  getUnreadCount,
};
