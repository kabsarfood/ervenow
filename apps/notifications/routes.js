const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../../shared/services/notificationService");
const {
  broadcastNotificationRead,
  roomForAppUser,
  roomForRecipient,
} = require("../../shared/lib/trackingSocket");

const router = express.Router();

function ok(res, payload = {}) {
  return res.json({ ok: true, ...payload });
}

function fail(res, message, code = 400) {
  return res.status(code).json({ ok: false, error: message || "error" });
}

function mapRoleToRecipientType(role) {
  const r = String(role || "").toLowerCase();
  if (r === "store" || r === "merchant" || r === "restaurant") return "store";
  if (r === "service") return "provider";
  if (r === "admin") return "admin";
  if (r === "driver") return "driver";
  return "customer";
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const recipientType = mapRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const limit = Number(req.query && req.query.limit);
    const unreadOnly = String(req.query && req.query.unread_only || "").toLowerCase() === "1";
    const items = await getNotifications(req.supabase, recipientType, recipientId, {
      limit,
      unreadOnly,
    });
    return ok(res, { items });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const recipientType = mapRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const unread_count = await getUnreadCount(req.supabase, recipientType, recipientId);
    return ok(res, { unread_count });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/read/:id", requireAuth, async (req, res) => {
  try {
    const recipientType = mapRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const notif = await markNotificationRead(
      req.supabase,
      req.params && req.params.id,
      recipientType,
      recipientId
    );
    if (!notif) return fail(res, "notification not found", 404);

    const unread_count = await getUnreadCount(req.supabase, recipientType, recipientId);
    broadcastNotificationRead(roomForAppUser(req.appUser), {
      id: notif.id,
      unread_count,
    });
    return ok(res, { notification: notif, unread_count });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/read-all", requireAuth, async (req, res) => {
  try {
    const recipientType = mapRoleToRecipientType(req.appUser && req.appUser.role);
    const recipientId = req.appUser && req.appUser.id;
    const out = await markAllNotificationsRead(req.supabase, recipientType, recipientId);
    broadcastNotificationRead(roomForRecipient(recipientType, recipientId), {
      all: true,
      unread_count: out.unread_count,
    });
    return ok(res, out);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
