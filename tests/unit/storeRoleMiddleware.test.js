const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  STORE_ACCOUNT_ROLES,
  isStoreAccountRole,
  normalizeStoreAccountRole,
} = require("../../shared/middleware/storeRole");

describe("storeRole middleware", () => {
  it("STORE_ACCOUNT_ROLES includes store and legacy alias", () => {
    assert.ok(STORE_ACCOUNT_ROLES.includes("store"));
    assert.ok(STORE_ACCOUNT_ROLES.includes("merchant"));
    assert.ok(STORE_ACCOUNT_ROLES.includes("restaurant"));
    assert.ok(STORE_ACCOUNT_ROLES.includes("admin"));
  });

  it("isStoreAccountRole accepts store and legacy", () => {
    assert.equal(isStoreAccountRole("store"), true);
    assert.equal(isStoreAccountRole("merchant"), true);
    assert.equal(isStoreAccountRole("restaurant"), true);
    assert.equal(isStoreAccountRole("customer"), false);
  });

  it("normalizeStoreAccountRole lowercases", () => {
    assert.equal(normalizeStoreAccountRole(" Store "), "store");
  });
});
