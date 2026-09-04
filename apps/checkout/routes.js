const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { denyUnlessCanPlaceOrders } = require("../../shared/middleware/platformAccess");
const { denyUnlessPublicOrdering } = require("../../shared/middleware/publicOrderingGate");
const { checkoutLimiter } = require("../../shared/middleware/apiRateLimits");
const { handleUnifiedCartCheckoutHttp } = require("../order/cartCheckoutHttp");

const router = express.Router();

/**
 * POST /api/checkout — مهمل: يُحوَّل إلى نفس منطق POST /api/order/create (سلة).
 * @deprecated Use POST /api/order/create with { items: [...] }
 */
router.post("/", requireAuth, denyUnlessCanPlaceOrders, denyUnlessPublicOrdering, checkoutLimiter, async (req, res) => {
  return handleUnifiedCartCheckoutHttp(req, res, { applyPaymentGate: false, deprecated: true });
});

module.exports = router;
