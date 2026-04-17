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

const DELIVERY_STATUSES = ["new", "accepted", "delivering", "delivered"];

function isValidDeliveryTransition(from, to) {
  const order = DELIVERY_STATUSES;
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0) return false;
  return j === i || j === i + 1;
}

module.exports = {
  ok,
  fail,
  extractBearer,
  isValidDeliveryTransition,
  DELIVERY_STATUSES,
};
