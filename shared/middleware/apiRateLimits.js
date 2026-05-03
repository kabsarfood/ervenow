const rateLimit = require("express-rate-limit");

/** POST /api/checkout — حماية من الإفراط */
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CHECKOUT_PER_MIN) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "too many checkout requests, try again shortly" },
});

/** POST /api/delivery/orders */
const deliveryOrdersCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_DELIVERY_ORDERS_PER_MIN) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "too many order creations, try again shortly" },
});

module.exports = {
  checkoutLimiter,
  deliveryOrdersCreateLimiter,
};
