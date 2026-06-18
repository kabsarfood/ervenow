const express = require("express");
const {
  recordPageVisit,
  recordRedirectError,
} = require("../../shared/utils/adminReadinessStore");
const { pathToPortalKey, pathToLegacyKey } = require("../../shared/utils/adminRoleTaxonomy");

function createAdminReadinessPageTracker() {
  return function adminReadinessPageTracker(req, res, next) {
    if (req.method !== "GET") return next();
    const pathname = req.path || "";
    const portalKey = pathToPortalKey(pathname);
    const legacyKey = pathToLegacyKey(pathname);
    if (!portalKey && !legacyKey) return next();
    void recordPageVisit({
      path: pathname,
      portalKey,
      legacyKey,
      userId: null,
    }).catch(() => {});
    next();
  };
}

module.exports = { createAdminReadinessPageTracker };
