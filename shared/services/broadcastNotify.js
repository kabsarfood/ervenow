const { createRoutedNotification } = require("../utils/notificationPortalRouting");

const BROADCAST_CATEGORIES = new Set([
  "alert",
  "development",
  "maintenance",
  "offer",
  "announcement",
]);

const BROADCAST_TARGETS = new Set([
  "customers",
  "merchants",
  "drivers",
  "services",
  "transport",
  "all",
  // توافق خلفي
  "providers",
  "everyone",
]);

const { isTransportPortalType, normServiceType } = require("../utils/resolvePortalRole");

function normalizeText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

function mapRoleToRecipientType(role) {
  const r = normalizeText(role).toLowerCase();
  if (r === "store" || r === "merchant" || r === "restaurant") return "store";
  if (r === "service") return "provider";
  if (r === "admin") return "admin";
  if (r === "driver") return "driver";
  return "customer";
}

function isTransportUser(user) {
  const st = normServiceType(user && user.service_type);
  return isTransportPortalType(st);
}

function normalizeBroadcastTarget(target) {
  const t = normalizeText(target).toLowerCase();
  if (t === "everyone") return "all";
  if (t === "providers") return "services";
  return t;
}

function matchesTarget(user, target) {
  const t = normalizeBroadcastTarget(target);
  const role = normalizeText(user && user.role).toLowerCase();
  if (t === "all") return true;
  if (t === "customers") return role === "customer" || role === "user" || !role;
  if (t === "drivers") return role === "driver";
  if (t === "merchants") return role === "store" || role === "merchant" || role === "restaurant";
  if (t === "services") return role === "service" && !isTransportUser(user);
  if (t === "transport") return role === "service" && isTransportUser(user);
  return false;
}

function isActiveUser(user) {
  if (!user || !user.id) return false;
  if (user.is_blocked === true || user.is_blocked === "true") return false;
  if (user.status && String(user.status).toLowerCase() === "blocked") return false;
  return true;
}

function mapBroadcastTargetToPortal(target) {
  const t = normalizeBroadcastTarget(target);
  if (t === "customers") return "customer";
  if (t === "merchants") return "merchant";
  if (t === "drivers") return "driver";
  if (t === "services") return "service";
  if (t === "transport") return "transport";
  return null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listBroadcastRecipients(sb, target) {
  const t = normalizeBroadcastTarget(target);
  if (!BROADCAST_TARGETS.has(t) && !BROADCAST_TARGETS.has(normalizeText(target).toLowerCase())) {
    throw new Error("target invalid");
  }

  const { data, error } = await sb.from("users").select("id, role, service_type, is_blocked, status");
  if (error) throw error;

  const out = [];
  const seen = new Set();
  for (const user of data || []) {
    if (!isActiveUser(user)) continue;
    if (!matchesTarget(user, t)) continue;
    const recipientType = mapRoleToRecipientType(user.role);
    const key = recipientType + ":" + user.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ recipient_type: recipientType, recipient_id: String(user.id) });
  }
  return out;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function sendBroadcast(sb, input) {
  if (!sb) throw new Error("supabase client is required");
  const title = normalizeText(input && input.title);
  const message = normalizeText(input && input.message);
  const category = normalizeText(input && input.category).toLowerCase();
  const target = normalizeBroadcastTarget(input && input.target);
  if (!title) throw new Error("title is required");
  if (!message) throw new Error("message is required");
  if (!BROADCAST_CATEGORIES.has(category)) throw new Error("category invalid");
  if (!BROADCAST_TARGETS.has(target)) throw new Error("target invalid");

  const recipients = await listBroadcastRecipients(sb, target);
  const broadcastId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "bc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);

  let sent = 0;
  const errors = [];
  for (const r of recipients) {
    try {
      await createRoutedNotification(sb, {
        recipient_type: r.recipient_type,
        recipient_id: r.recipient_id,
        title,
        message,
        type: "broadcast",
        source: "admin",
        target_portal: mapBroadcastTargetToPortal(target),
        payload: {
          category,
          target,
          audience: target,
          broadcast_id: broadcastId,
        },
      });
      sent += 1;
    } catch (e) {
      errors.push({ recipient_id: r.recipient_id, error: e.message || String(e) });
    }
  }

  return {
    ok: true,
    broadcast_id: broadcastId,
    target,
    category,
    recipients: recipients.length,
    sent,
    failed: errors.length,
    errors: errors.slice(0, 20),
  };
}

module.exports = {
  BROADCAST_CATEGORIES,
  BROADCAST_TARGETS,
  normalizeBroadcastTarget,
  mapBroadcastTargetToPortal,
  sendBroadcast,
  listBroadcastRecipients,
};
