/**
 * دور حساب المتجر (Store Account) — users.role = store
 * توافق مؤقت: merchant | restaurant (legacy login roles)
 */
const { fail } = require("../utils/helpers");

const STORE_ACCOUNT_ROLES = ["store", "merchant", "restaurant", "admin"];

function normalizeStoreAccountRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isStoreAccountRole(role) {
  return STORE_ACCOUNT_ROLES.includes(normalizeStoreAccountRole(role));
}

/** @deprecated استخدم isStoreAccountRole — الاسم القديم للتوافق */
function isMerchantPanelRole(role) {
  return isStoreAccountRole(role);
}

function requireStoreRole(req, res, next) {
  const r = normalizeStoreAccountRole(req.appUser?.role);
  if (STORE_ACCOUNT_ROLES.includes(r)) return next();
  return fail(res, "يتطلب حساب متجر (Store Account) مرتبط بالمنصة", 403);
}

/** @deprecated alias — يستدعي requireStoreRole */
const requireMerchantRole = requireStoreRole;

module.exports = {
  STORE_ACCOUNT_ROLES,
  normalizeStoreAccountRole,
  isStoreAccountRole,
  isMerchantPanelRole,
  requireStoreRole,
  requireMerchantRole,
};
