const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../../shared/services/notificationService");
const {
  resolveAppUserPortal,
  mapAppRoleToRecipientType,
  filterNotificationsForPortal,
} = require("../../shared/utils/notificationPortalRouting");
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

function portalContextFromUser(appUser) {
  return {
    portalRole: resolveAppUserPortal(appUser),
    role: appUser && appUser.role,
    service_type: appUser && appUser.service_type,
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const recipientType = mapAppRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const limit = Number(req.query && req.query.limit);
    const unreadOnly = String(req.query && req.query.unread_only || "").toLowerCase() === "1";
    const items = await getNotifications(req.supabase, recipientType, recipientId, {
      limit,
      unreadOnly,
    });
    const portalCtx = portalContextFromUser(req.appUser);
    const filtered = filterNotificationsForPortal(items, portalCtx);
    return ok(res, { items: filtered, portal: portalCtx.portalRole });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const recipientType = mapAppRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const items = await getNotifications(req.supabase, recipientType, recipientId, {
      limit: 100,
      unreadOnly: true,
    });
    const portalCtx = portalContextFromUser(req.appUser);
    const unread_count = filterNotificationsForPortal(items, portalCtx).length;
    return ok(res, { unread_count, portal: portalCtx.portalRole });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/read/:id", requireAuth, async (req, res) => {
  try {
    const recipientType = mapAppRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const notif = await markNotificationRead(
      req.supabase,
      req.params && req.params.id,
      recipientType,
      recipientId
    );
    if (!notif) return fail(res, "notification not found", 404);

    const items = await getNotifications(req.supabase, recipientType, recipientId, {
      limit: 100,
      unreadOnly: true,
    });
    const portalCtx = portalContextFromUser(req.appUser);
    const unread_count = filterNotificationsForPortal(items, portalCtx).length;
    broadcastNotificationRead(roomForAppUser(req.appUser), {
      id: notif.id,
      unread_count,
    });
    return ok(res, { notification: notif, unread_count, portal: portalCtx.portalRole });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/read-all", requireAuth, async (req, res) => {
  try {
    const recipientType = mapAppRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    await markAllNotificationsRead(req.supabase, recipientType, recipientId);
    return ok(res, { unread_count: 0, portal: resolveAppUserPortal(req.appUser) });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
