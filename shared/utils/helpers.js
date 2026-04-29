function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

function fail(res, message, status = 400, extra = {}) {
  if (process.env.NODE_ENV === "production" && status === 500) {
    return res.status(status).json({ ok: false, error: "Internal server error" });
  }
  return res.status(status).json({ ok: false, error: message, ...extra });
}

function extractBearer(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

/** طلب مفتوح (لم يُسند بعد) — new قديم، pending شائع في قواعد جاهزة/كبسار */
const OPEN_DELIVERY_STATUSES = new Set(["new", "pending"]);

function deliveryLifecycleIndex(s) {
  if (s === "new" || s === "pending") return 0;
  if (s === "accepted") return 1;
  if (s === "delivering") return 2;
  if (s === "delivered") return 3;
  return -1;
}

const DELIVERY_STATUSES = ["pending", "accepted", "delivering", "delivered"];

function isValidDeliveryTransition(from, to) {
  const i = deliveryLifecycleIndex(from);
  const j = deliveryLifecycleIndex(to);
  if (i < 0 || j < 0) return false;
  return j === i || j === i + 1;
}

module.exports = {
  ok,
  fail,
  extractBearer,
  isValidDeliveryTransition,
  DELIVERY_STATUSES,
  OPEN_DELIVERY_STATUSES,
  deliveryLifecycleIndex,
};
