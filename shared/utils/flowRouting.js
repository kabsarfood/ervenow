/**
 * ERVENOW Flow Separation 3.0 — unified routing exports
 */

const orderRouting = require("./orderPortalRouting");
const notificationRouting = require("./notificationPortalRouting");
const walletRouting = require("./walletPortalRouting");
const { resolvePortalRole } = require("./resolvePortalRole");
const { OPERATIONAL_PORTAL_ROLES } = require("./portalLaunch");

module.exports = {
  OPERATIONAL_PORTAL_ROLES,
  resolvePortalRole,
  ...orderRouting,
  ...notificationRouting,
  ...walletRouting,
};
