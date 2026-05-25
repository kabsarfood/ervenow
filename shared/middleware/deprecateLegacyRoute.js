/**
 * ترويسة Deprecation للمسارات الموحّدة.
 */

const UNIFIED_ORDER_CREATE = "POST /api/order/create";
const UNIFIED_ORDER_STATUS = "PATCH /api/order/:id/status";

function setDeprecationHeaders(res, replacement) {
  res.setHeader("Deprecation", "true");
  res.setHeader("X-ERVENOW-Unified-Replacement", replacement);
  res.setHeader("Link", `<${replacement}>; rel="successor-version"`);
}

module.exports = {
  UNIFIED_ORDER_CREATE,
  UNIFIED_ORDER_STATUS,
  setDeprecationHeaders,
};
