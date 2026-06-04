/**
 * Socket.IO — تتبع لحظي للمندوب حسب الطلب (غرف order:<uuid>).
 * المصادقة: handshake.auth.token (JWT).
 * join:order — زائر الطلب أو المندوب المعيّن أو الإدارة.
 * driver:location — المندوب المعيّن لهذا الطلب فقط.
 */

const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../middleware/auth");
const { createServiceClient } = require("../config/supabase");

function safeOrderRoomId(orderId) {
  const s = String(orderId == null ? "" : orderId).trim();
  if (!s) return null;
  return "order:" + s;
}

function safeUserRoomIdByRecipient(recipientType, recipientId) {
  const t = String(recipientType || "").trim().toLowerCase();
  const id = String(recipientId || "").trim();
  if (!t || !id) return null;
  return `notif:${t}:${id}`;
}

function safeUserRoomIdByUserId(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `notif:user:${id}`;
}

/** حد أدنى ~2 ثانية بين بث موقع نفس المندوب (REST + Socket يشتركان في نفس العداد). */
const driverLocationLastBroadcast = new Map();

/** مرجع io يُضبط من server بعد التشغيل — لبث driver:update و order:patch من مسارات REST. */
let trackingIo = null;

function setTrackingIo(io) {
  trackingIo = io || null;
}

/**
 * @param {string} driverUserId
 * @param {string} [orderId] — عند تعدّد الطلبات لنفس المندوب يُحسب الحدّ لكل غرفة على حدة
 * @returns {boolean} true إذا سُمح بالبث الآن
 */
function consumeDriverLocationThrottle(driverUserId, orderId) {
  const id = String(driverUserId == null ? "" : driverUserId).trim();
  if (!id) return true;
  const oid = orderId != null ? String(orderId).trim() : "";
  const key = oid ? id + ":" + oid : id;
  const nowMs = Date.now();
  const lastMs = driverLocationLastBroadcast.get(key) || 0;
  if (nowMs - lastMs < 2000) return false;
  driverLocationLastBroadcast.set(key, nowMs);
  return true;
}

function orderPatchFromRow(row) {
  if (!row || row.id == null) return {};
  const keys = [
    "id",
    "delivery_status",
    "status",
    "updated_at",
    "last_location_at",
    "driver_lat",
    "driver_lng",
    "driver_id",
    "order_number",
    "pickup_lat",
    "pickup_lng",
    "drop_lat",
    "drop_lng",
    "pickup_address",
    "drop_address",
  ];
  const pick = {};
  for (const k of keys) {
    if (row[k] !== undefined) pick[k] = row[k];
  }
  return pick;
}

function broadcastDriverUpdate(orderId, driverUserId, payload) {
  if (!trackingIo) return;
  const room = safeOrderRoomId(orderId);
  if (!room) return;
  if (driverUserId != null && !consumeDriverLocationThrottle(driverUserId, orderId)) return;
  const p =
    payload && typeof payload === "object"
      ? { ...payload, ts: payload.ts != null ? Number(payload.ts) : Date.now() }
      : { ts: Date.now() };
  trackingIo.to(room).emit("driver:update", p);
}

function broadcastOrderPatch(orderId, patch) {
  if (!trackingIo) return;
  const room = safeOrderRoomId(orderId);
  if (!room) return;
  const oid = String(orderId || "").trim();
  trackingIo.to(room).emit("order:patch", { orderId: oid, patch: patch || {} });
}

function broadcastOrderLive(orderId, payload) {
  if (!trackingIo) return;
  const room = safeOrderRoomId(orderId);
  if (!room) return;
  const oid = String(orderId || "").trim();
  trackingIo.to(room).emit("order:live", { orderId: oid, ...(payload && typeof payload === "object" ? payload : {}) });
}

function broadcastNotificationNew(roomOrRecipientType, recipientId, payload) {
  if (!trackingIo) return;
  const room = recipientId == null
    ? String(roomOrRecipientType || "").trim()
    : safeUserRoomIdByRecipient(roomOrRecipientType, recipientId);
  if (!room) return;
  trackingIo.to(room).emit("notification:new", payload && typeof payload === "object" ? payload : {});
}

function broadcastNotificationRead(roomOrRecipientType, recipientIdOrPayload, maybePayload) {
  if (!trackingIo) return;
  const room = maybePayload == null
    ? String(roomOrRecipientType || "").trim()
    : safeUserRoomIdByRecipient(roomOrRecipientType, recipientIdOrPayload);
  const payload = maybePayload == null ? recipientIdOrPayload : maybePayload;
  if (!room) return;
  trackingIo.to(room).emit("notification:read", payload && typeof payload === "object" ? payload : {});
}

function roomForRecipient(recipientType, recipientId) {
  return safeUserRoomIdByRecipient(recipientType, recipientId);
}

function roomForAppUser(appUser) {
  if (!appUser || !appUser.id) return null;
  const role = String(appUser.role || "customer").toLowerCase();
  const recipientType =
    role === "store" || role === "merchant" || role === "restaurant"
      ? "store"
      : role === "service"
        ? "provider"
        : role === "admin"
          ? "admin"
          : role === "driver"
            ? "driver"
            : "customer";
  return safeUserRoomIdByRecipient(recipientType, appUser.id);
}

async function fetchOrderForTracking(sb, orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;
  const { data, error } = await sb
    .from("orders")
    .select("id, customer_id, driver_id, delivery_status")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function attachTrackingSocket(io) {
  trackingIo = io;
  io.use((socket, next) => {
    const raw =
      (socket.handshake.auth && socket.handshake.auth.token) ||
      String(socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    const token = String(raw || "").trim();
    if (!token) {
      return next(new Error("UNAUTHORIZED"));
    }
    try {
      const secret = getJwtSecret();
      const p = jwt.verify(token, secret);
      const sub = p.sub;
      if (!sub) return next(new Error("UNAUTHORIZED"));
      socket.data.userId = String(sub);
      socket.data.role = String(p.role || "customer").toLowerCase();
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
    next();
  });

  io.on("connection", (socket) => {
    const uidRoom = safeUserRoomIdByUserId(socket.data.userId);
    if (uidRoom) socket.join(uidRoom);

    const role = String(socket.data.role || "customer").toLowerCase();
    const mappedRecipientType =
      role === "merchant" || role === "restaurant"
        ? "store"
        : role === "service"
          ? "provider"
          : role === "admin"
            ? "admin"
            : role === "driver"
              ? "driver"
              : "customer";
    const notifRoom = safeUserRoomIdByRecipient(mappedRecipientType, socket.data.userId);
    if (notifRoom) socket.join(notifRoom);

    socket.on("join:order", async (orderId) => {
      const room = safeOrderRoomId(orderId);
      if (!room) return;
      const sb = createServiceClient();
      if (!sb) return;
      const uid = socket.data.userId;
      const role = socket.data.role;
      if (!uid) return;
      try {
        const order = await fetchOrderForTracking(sb, orderId);
        if (!order) return;
        const driverOk = String(order.driver_id || "") === String(uid);
        const customerOk = order.customer_id != null && String(order.customer_id) === String(uid);
        if (role === "admin" || driverOk || customerOk) {
          socket.join(room);
        }
      } catch {
        /* ignore */
      }
    });

    socket.on("leave:order", (orderId) => {
      const room = safeOrderRoomId(orderId);
      if (!room) return;
      socket.leave(room);
    });

    socket.on("driver:location", async (data) => {
      if (!data || typeof data !== "object") return;
      if (socket.data.role !== "driver") return;

      const orderId = data.orderId;
      const lat = data.lat;
      const lng = data.lng;
      const room = safeOrderRoomId(orderId);
      if (!room) return;
      const la = Number(lat);
      const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      if (Math.abs(la) > 90 || Math.abs(ln) > 180) return;

      const sb = createServiceClient();
      if (!sb) return;
      const driverUserId = socket.data.userId;
      try {
        const { data: row, error } = await sb
          .from("orders")
          .select("id, driver_id, delivery_status")
          .eq("id", String(orderId).trim())
          .maybeSingle();
        if (error || !row) return;
        if (String(row.driver_id || "") !== String(driverUserId)) return;
        const ds = String(row.delivery_status || "");
        if (!["accepted", "delivering", "picked"].includes(ds)) return;
      } catch {
        return;
      }

      if (!consumeDriverLocationThrottle(driverUserId, orderId)) return;

      const speed = data.speed;
      const heading = data.heading;
      const sp = speed == null || speed === "" ? null : Number(speed);
      const hd = heading == null || heading === "" ? null : Number(heading);
      const payload = {
        lat: la,
        lng: ln,
        ts: Date.now(),
      };
      if (Number.isFinite(sp)) payload.speed = sp;
      if (Number.isFinite(hd)) payload.heading = hd;

      io.to(room).emit("driver:update", payload);
    });
  });
}

module.exports = {
  attachTrackingSocket,
  /** @deprecated يُضبط تلقائياً داخل attachTrackingSocket — للتوافق مع نداءات قديمة */
  setTrackingIo,
  orderPatchFromRow,
  broadcastDriverUpdate,
  broadcastOrderPatch,
  broadcastOrderLive,
  broadcastNotificationNew,
  broadcastNotificationRead,
  roomForRecipient,
  roomForAppUser,
};
