const {
  STORE_ACCOUNT_ROLES,
  isStoreAccountRole,
  normalizeStoreAccountRole,
} = require("../../shared/middleware/storeRole");

describe("storeRole middleware", () => {
  test("STORE_ACCOUNT_ROLES includes store and legacy alias", () => {
    expect(STORE_ACCOUNT_ROLES).toContain("store");
    expect(STORE_ACCOUNT_ROLES).toContain("merchant");
    expect(STORE_ACCOUNT_ROLES).toContain("restaurant");
    expect(STORE_ACCOUNT_ROLES).toContain("admin");
  });

  test("isStoreAccountRole accepts store and legacy", () => {
    expect(isStoreAccountRole("store")).toBe(true);
    expect(isStoreAccountRole("merchant")).toBe(true);
    expect(isStoreAccountRole("restaurant")).toBe(true);
    expect(isStoreAccountRole("customer")).toBe(false);
  });

  test("normalizeStoreAccountRole lowercases", () => {
    expect(normalizeStoreAccountRole(" Store ")).toBe("store");
  });
});
