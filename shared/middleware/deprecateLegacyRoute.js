/**
 * ترويسة Deprecation للمسارات الموحّدة + تسجيل تحذير في logs.
 */

const { logger } = require("../utils/logger");

const UNIFIED_ORDER_CREATE = "POST /api/order/create";
const UNIFIED_ORDER_STATUS = "PATCH /api/order/:id/status";

function isB2BOrderSource(req) {
  const src = String((req && req.get && req.get("X-Source")) || "").trim().toLowerCase();
  return src === "kabsar-pos" || src === "kabsar-web" || src.startsWith("b2b-");
}

function setDeprecationHeaders(res, replacement) {
  res.setHeader("Deprecation", "true");
  res.setHeader("X-ERVENOW-Deprecated", "Use /api/order/create or /api/order/:id/status");
  res.setHeader("X-ERVENOW-Unified-Replacement", replacement);
  res.setHeader("Link", `<${replacement}>; rel="successor-version"`);
}

function logDeprecationWarning(req, legacyRoute, replacement) {
  if (!req || isB2BOrderSource(req)) return;
  logger.warn(
    {
      legacyRoute,
      replacement,
      path: req.originalUrl || req.url,
      method: req.method,
      userId: req.appUser && req.appUser.id,
      source: req.get && req.get("X-Source"),
    },
    "[DEPRECATED] Legacy order route — migrate to " + replacement
  );
}

/** @param {import("express").Request} req @param {import("express").Response} res */
function deprecateLegacyOrderRoute(req, res, legacyRoute, replacement) {
  setDeprecationHeaders(res, replacement);
  logDeprecationWarning(req, legacyRoute, replacement);
}

module.exports = {
  UNIFIED_ORDER_CREATE,
  UNIFIED_ORDER_STATUS,
  isB2BOrderSource,
  setDeprecationHeaders,
  logDeprecationWarning,
  deprecateLegacyOrderRoute,
};
