const {
  isUserAccountApproved,
  isUserAccountPending,
  isPendingAuthAllowedPath,
  normalizeAccountStatus,
} = require("../../shared/utils/accountApproval");

describe("accountApproval", () => {
  test("pending user is not approved", () => {
    expect(isUserAccountPending("pending")).toBe(true);
    expect(isUserAccountApproved("pending")).toBe(false);
  });

  test("active user is approved", () => {
    expect(isUserAccountApproved("active")).toBe(true);
    expect(isUserAccountPending("active")).toBe(false);
  });

  test("pending may call /api/core/me only among protected routes", () => {
    const req = { baseUrl: "", path: "/api/core/me" };
    expect(isPendingAuthAllowedPath(req)).toBe(true);
    const req2 = { baseUrl: "/api/wallet", path: "/me" };
    expect(isPendingAuthAllowedPath(req2)).toBe(false);
  });

  test("legacy empty status is treated as active", () => {
    expect(normalizeAccountStatus(null, "customer")).toBe("active");
    expect(isUserAccountApproved(null, "customer")).toBe(true);
    expect(isUserAccountPending(null)).toBe(false);
    expect(isUserAccountPending("pending")).toBe(true);
  });

  test("blocked role or status is not approved", () => {
    expect(isUserAccountApproved("blocked", "customer")).toBe(false);
    expect(isUserAccountApproved("active", "blocked")).toBe(false);
  });
});
