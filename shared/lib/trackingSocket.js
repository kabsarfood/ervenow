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

/** حد أدنى 2 ثانية بين بث موقع نفس المندوب (يقلّل spam). */
const driverLocationLastBroadcast = new Map();

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

      const nowMs = Date.now();
      const lastMs = driverLocationLastBroadcast.get(driverUserId) || 0;
      if (nowMs - lastMs < 2000) return;
      driverLocationLastBroadcast.set(driverUserId, nowMs);

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

module.exports = { attachTrackingSocket };
