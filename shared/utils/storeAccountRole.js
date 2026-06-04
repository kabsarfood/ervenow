/**
 * Store Account — users.role helpers (بدون middleware)
 */
const {
  STORE_ACCOUNT_ROLES,
  normalizeStoreAccountRole,
  isStoreAccountRole,
  isMerchantPanelRole,
} = require("../middleware/storeRole");

module.exports = {
  STORE_ACCOUNT_ROLES,
  normalizeStoreAccountRole,
  isStoreAccountRole,
  isMerchantPanelRole,
};
