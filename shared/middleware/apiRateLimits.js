const rateLimit = require("express-rate-limit");

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** مفتاح حد المعدّل: مستخدم مصدّق ثم IP (لا يغيّر منطق الصلاحيات). */
function userAwareKey(req) {
  const ip = clientIp(req);
  const u = req.appUser;
  if (u && u.id) return `uid:${u.id}`;
  if (u && u.phone) return `phone:${String(u.phone).replace(/\s/g, "")}`;
  return `ip:${ip}`;
}

/** POST /api/checkout — حماية من الإفراط */
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CHECKOUT_PER_MIN) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userAwareKey,
  message: { ok: false, error: "RATE_LIMIT", message: "too many checkout requests, try again shortly" },
});

/** POST /api/delivery/orders */
const deliveryOrdersCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_DELIVERY_ORDERS_PER_MIN) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userAwareKey,
  message: { ok: false, error: "RATE_LIMIT", message: "too many order creations, try again shortly" },
});

module.exports = {
  checkoutLimiter,
  deliveryOrdersCreateLimiter,
  userAwareKey,
};
