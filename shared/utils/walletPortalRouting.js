/**
 * ERVENOW Flow Separation 3.0 — Wallet Routing Engine
 */

const { resolvePortalRole } = require("./resolvePortalRole");

/** @type {readonly string[]} */
const WALLET_PORTAL_TYPES = ["merchant", "driver", "service", "transport"];

const WALLET_PORTAL_SET = new Set(WALLET_PORTAL_TYPES);

/**
 * @param {{ role?: string, service_type?: string|null }|null|undefined} appUser
 * @returns {"merchant"|"driver"|"service"|"transport"|null}
 */
function resolveUserWalletPortal(appUser) {
  const { portalRole } = resolvePortalRole(appUser);
  if (WALLET_PORTAL_SET.has(portalRole)) return portalRole;
  return null;
}

/**
 * @param {string} role
 */
function walletPortalFromDbRole(role) {
  return resolveUserWalletPortal({ role });
}

/**
 * @param {object} withdrawal
 * @param {string} portalType
 */
function withdrawalBelongsToPortal(withdrawal, portalType) {
  const portal = String(portalType || "").trim().toLowerCase();
  const rowPortal = String(
    (withdrawal && (withdrawal.portal_type || withdrawal.source_portal)) || ""
  ).toLowerCase();

  if (!rowPortal) return true;
  return rowPortal === portal;
}

/**
 * @param {object} withdrawal
 * @param {string} portalType
 */
function annotateWithdrawalPortal(withdrawal, portalType) {
  const portal_type = portalType || resolveOrderPortalTypeFallback(withdrawal);
  return Object.assign({}, withdrawal, { portal_type });
}

function resolveOrderPortalTypeFallback(row) {
  if (row && row.portal_type) return row.portal_type;
  if (row && row.source === "store_withdrawals") return "merchant";
  if (row && row.user_role) return walletPortalFromDbRole(row.user_role);
  return null;
}

/**
 * @param {object[]} rows
 * @param {string} portalType
 */
function filterWithdrawalsForPortal(rows, portalType) {
  return (rows || []).map((r) => annotateWithdrawalPortal(r, portalType));
}

module.exports = {
  WALLET_PORTAL_TYPES,
  WALLET_PORTAL_SET,
  resolveUserWalletPortal,
  walletPortalFromDbRole,
  withdrawalBelongsToPortal,
  annotateWithdrawalPortal,
  filterWithdrawalsForPortal,
};
