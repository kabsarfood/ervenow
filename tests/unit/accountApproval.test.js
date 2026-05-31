const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isUserAccountApproved,
  isUserAccountPending,
  isPendingAuthAllowedPath,
} = require("../../shared/utils/accountApproval");

test("pending user is not approved", () => {
  assert.equal(isUserAccountPending("pending"), true);
  assert.equal(isUserAccountApproved("pending"), false);
});

test("active user is approved", () => {
  assert.equal(isUserAccountApproved("active"), true);
  assert.equal(isUserAccountPending("active"), false);
});

test("pending may call /api/core/me only among protected routes", () => {
  const req = { baseUrl: "", path: "/api/core/me" };
  assert.equal(isPendingAuthAllowedPath(req), true);
  const req2 = { baseUrl: "/api/wallet", path: "/me" };
  assert.equal(isPendingAuthAllowedPath(req2), false);
});

test("legacy empty status is treated as active", () => {
  const { normalizeAccountStatus, isUserAccountApproved, isUserAccountPending } = require("../../shared/utils/accountApproval");
  assert.equal(normalizeAccountStatus(null, "customer"), "active");
  assert.equal(isUserAccountApproved(null, "customer"), true);
  assert.equal(isUserAccountPending(null), false);
  assert.equal(isUserAccountPending("pending"), true);
});

test("blocked role or status is not approved", () => {
  assert.equal(isUserAccountApproved("blocked", "customer"), false);
  assert.equal(isUserAccountApproved("active", "blocked"), false);
});
