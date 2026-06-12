/**
 * Order Draft Store — Node/test entry (mirrors shared/orderDraft/*).
 * المتصفح يستخدم order-draft-store.js (IIFE بدون require).
 */
const schema = require("../../shared/orderDraft/orderDraftSchema");
const migrate = require("../../shared/orderDraft/migrateFromLegacyCart");
const core = require("../../shared/orderDraft/orderDraftStoreCore");

module.exports = {
  schema,
  migrate,
  core,
};
