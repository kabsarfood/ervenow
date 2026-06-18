/**
 * ERVENOW Flow Separation 3.0 — Notification Routing Engine
 */

const { resolvePortalRole } = require("./resolvePortalRole");
const { resolveOrderPortalType } = require("./orderPortalRouting");
const { createNotification } = require("../services/notificationService");

/** @type {readonly string[]} */
const NOTIFICATION_TARGET_PORTALS = [
  "merchant",
  "driver",
  "service",
  "transport",
  "customer",
  "admin",
];

const TARGET_PORTAL_SET = new Set(NOTIFICATION_TARGET_PORTALS);

/**
 * @param {{ role?: string, service_type?: string|null }|null|undefined} appUser
 */
function resolveAppUserPortal(appUser) {
  return resolvePortalRole(appUser).portalRole;
}

function mapPortalToRecipientType(portal) {
  const p = String(portal || "").trim().toLowerCase();
  if (p === "merchant") return "store";
  if (p === "driver") return "driver";
  if (p === "service" || p === "transport") return "provider";
  if (p === "admin") return "admin";
  return "customer";
}

function mapAppRoleToRecipientType(role) {
  return mapPortalToRecipientType(resolvePortalRole({ role }).portalRole);
}

function normalizePayload(payload) {
  if (payload == null) return {};
  if (typeof payload === "object" && !Array.isArray(payload)) return { ...payload };
  return {};
}

/**
 * @param {object} input
 * @returns {object}
 */
function enrichRoutedNotificationInput(input) {
  const base = input && typeof input === "object" ? input : {};
  const payload = normalizePayload(base.payload);

  let target_portal = base.target_portal || payload.target_portal || null;
  let target_role = base.target_role || payload.target_role || null;

  if (!target_portal && base.portal_type) target_portal = base.portal_type;
  if (!target_portal && payload.portal_type) target_portal = payload.portal_type;
  if (!target_portal && base.order) target_portal = resolveOrderPortalType(base.order);
  if (!target_portal && payload.order_id && base.order_portal_type) {
    target_portal = base.order_portal_type;
  }

  if (target_portal) {
    target_portal = String(target_portal).trim().toLowerCase();
    payload.target_portal = target_portal;
    payload.portal_type = payload.portal_type || target_portal;
  }
  if (target_role) {
    target_role = String(target_role).trim().toLowerCase();
    payload.target_role = target_role;
  }

  return {
    recipient_type: base.recipient_type,
    recipient_id: base.recipient_id,
    title: base.title,
    message: base.message,
    type: base.type,
    source: base.source,
    payload,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} input
 */
async function createRoutedNotification(sb, input) {
  return createNotification(sb, enrichRoutedNotificationInput(input));
}

/**
 * @param {object} notif
 * @param {{ portalRole?: string, role?: string, service_type?: string|null }|string} portalContext
 */
function notificationBelongsToPortal(notif, portalContext) {
  const userPortal =
    typeof portalContext === "string"
      ? portalContext
      : portalContext.portalRole || resolveAppUserPortal(portalContext);

  const payload = (notif && notif.payload) || {};
  const targetPortal = String(payload.target_portal || payload.portal_type || "").toLowerCase();
  if (!targetPortal) return true;

  const p = String(userPortal || "").toLowerCase();
  if (p === targetPortal) return true;

  if (p === "service" && targetPortal === "service") return true;
  if (p === "transport" && targetPortal === "transport") return true;

  return false;
}

/**
 * @param {object[]} items
 * @param {object|string} portalContext
 */
function filterNotificationsForPortal(items, portalContext) {
  return (items || []).filter((n) => notificationBelongsToPortal(n, portalContext));
}

module.exports = {
  NOTIFICATION_TARGET_PORTALS,
  TARGET_PORTAL_SET,
  resolveAppUserPortal,
  mapPortalToRecipientType,
  mapAppRoleToRecipientType,
  enrichRoutedNotificationInput,
  createRoutedNotification,
  notificationBelongsToPortal,
  filterNotificationsForPortal,
};
