const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../../shared/services/notificationService");
const {
  resolveAppUserPortal,
  mapAppRoleToRecipientType,
  filterNotificationsForPortal,
} = require("../../shared/utils/notificationPortalRouting");
const { portalRoleForProvider } = require("../../shared/utils/resolvePortalRole");
const {
  broadcastNotificationRead,
  roomForAppUser,
} = require("../../shared/lib/trackingSocket");

const router = express.Router();

function ok(res, payload = {}) {
  return res.json({ ok: true, ...payload });
}

function fail(res, message, code = 400) {
  return res.status(code).json({ ok: false, error: message || "error" });
}

async function loadProviderProfile(sb, userId) {
  if (!sb || !userId) return null;
  const { data, error } = await sb
    .from("users")
    .select("id, role, service_type")
    .eq("id", String(userId))
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function portalContextFromRequest(req) {
  const appUser = req.appUser;
  const role = String((appUser && appUser.role) || "").toLowerCase();
  let service_type = appUser && appUser.service_type;
  let portalRole = resolveAppUserPortal(appUser);

  if ((role === "service" || role === "driver") && req.supabase && appUser && appUser.id) {
    const profile = await loadProviderProfile(req.supabase, appUser.id);
    if (profile) {
      portalRole = portalRoleForProvider(appUser, profile);
      service_type = profile.service_type;
    }
  }

  return {
    portalRole,
    role: appUser && appUser.role,
    service_type,
  };
}

function recipientTypesForPortalContext(portalCtx, appUser) {
  const role = String((appUser && appUser.role) || "").toLowerCase();
  const types = new Set([mapAppRoleToRecipientType(role)]);
  const st = String((portalCtx && portalCtx.service_type) || "").trim();
  if ((role === "service" || role === "driver") && st) {
    types.add("provider");
  }
  return [...types];
}

async function fetchNotificationsMerged(req, opts) {
  const portalCtx = await portalContextFromRequest(req);
  const recipientId = req.appUser && req.appUser.id;
  const types = recipientTypesForPortalContext(portalCtx, req.appUser);
  const seen = new Set();
  const merged = [];

  for (const recipientType of types) {
    const rows = await getNotifications(req.supabase, recipientType, recipientId, opts);
    for (const row of rows || []) {
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }

  merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const limit = Math.max(1, Math.min(100, Number(opts && opts.limit) || 20));
  const filtered = filterNotificationsForPortal(merged.slice(0, limit * 2), portalCtx);
  return { items: filtered.slice(0, limit), portalCtx };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query && req.query.limit);
    const unreadOnly = String(req.query && req.query.unread_only || "").toLowerCase() === "1";
    const { items, portalCtx } = await fetchNotificationsMerged(req, { limit, unreadOnly });
    return ok(res, { items, portal: portalCtx.portalRole });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const { items, portalCtx } = await fetchNotificationsMerged(req, { limit: 100, unreadOnly: true });
    return ok(res, { unread_count: items.length, portal: portalCtx.portalRole });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/read/:id", requireAuth, async (req, res) => {
  try {
    const recipientType = mapAppRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    let notif = await markNotificationRead(
      req.supabase,
      req.params && req.params.id,
      recipientType,
      recipientId
    );
    if (!notif) {
      notif = await markNotificationRead(req.supabase, req.params && req.params.id, "provider", recipientId);
    }
    if (!notif) return fail(res, "notification not found", 404);

    const { items, portalCtx } = await fetchNotificationsMerged(req, { limit: 100, unreadOnly: true });
    broadcastNotificationRead(roomForAppUser(req.appUser), {
      id: notif.id,
      unread_count: items.length,
    });
    return ok(res, { notification: notif, unread_count: items.length, portal: portalCtx.portalRole });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/read-all", requireAuth, async (req, res) => {
  try {
    const recipientId = req.appUser && req.appUser.id;
    const portalCtx = await portalContextFromRequest(req);
    const types = recipientTypesForPortalContext(portalCtx, req.appUser);
    for (const recipientType of types) {
      await markAllNotificationsRead(req.supabase, recipientType, recipientId);
    }
    return ok(res, { unread_count: 0 });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
