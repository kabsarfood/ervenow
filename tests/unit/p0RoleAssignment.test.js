const {
  SENSITIVE_ROLES,
  SELF_SERVICE_SIGNUP_ROLES,
  normalizeRequestedRole,
  isSensitiveRole,
  resolveSelfServiceSignupRole,
  denyClientRolePayload,
  existingUserSessionRole,
  canAdminOtpLogin,
} = require("../../shared/utils/roleAssignment");

describe("P0-01 role assignment", () => {
  test("admin is sensitive and not self-service", () => {
    expect(SENSITIVE_ROLES).toContain("admin");
    expect(SELF_SERVICE_SIGNUP_ROLES).not.toContain("admin");
    expect(isSensitiveRole("admin")).toBe(true);
    expect(isSensitiveRole("ADMIN")).toBe(true);
  });

  test("rejects self-service signup as admin", () => {
    const out = resolveSelfServiceSignupRole("admin");
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.role).toBeNull();
  });

  test("maps provider and transport aliases to service — not admin", () => {
    expect(normalizeRequestedRole("provider")).toBe("service");
    expect(normalizeRequestedRole("transport")).toBe("service");
    expect(resolveSelfServiceSignupRole("provider").ok).toBe(true);
    expect(resolveSelfServiceSignupRole("provider").role).toBe("service");
    expect(resolveSelfServiceSignupRole("transport").role).toBe("service");
  });

  test("merchant and driver remain self-service signup roles (pending approval)", () => {
    expect(resolveSelfServiceSignupRole("merchant").role).toBe("merchant");
    expect(resolveSelfServiceSignupRole("driver").role).toBe("driver");
    expect(resolveSelfServiceSignupRole("store").role).toBe("store");
  });

  test("unknown / internal roles coerce to customer", () => {
    expect(resolveSelfServiceSignupRole("superuser").role).toBe("customer");
    expect(resolveSelfServiceSignupRole("platform").role).toBe("customer");
  });

  test("client role payload is always denied", () => {
    expect(denyClientRolePayload({ role: "admin" })).toEqual(
      expect.objectContaining({ status: 403 })
    );
    expect(denyClientRolePayload({ role: "merchant" })).toEqual(
      expect.objectContaining({ status: 403 })
    );
    expect(denyClientRolePayload({ role: "driver" })).toEqual(
      expect.objectContaining({ status: 403 })
    );
    expect(denyClientRolePayload({ role: "provider" })).toEqual(
      expect.objectContaining({ status: 403 })
    );
    expect(denyClientRolePayload({ role: "transport" })).toEqual(
      expect.objectContaining({ status: 403 })
    );
    expect(denyClientRolePayload({ phone: "0500000000" })).toBeNull();
  });

  test("existing user session role is frozen from DB, not from client", () => {
    expect(existingUserSessionRole("customer")).toBe("customer");
    expect(existingUserSessionRole("admin")).toBe("admin");
  });

  test("admin OTP login requires existing admin row + allowlist", () => {
    expect(canAdminOtpLogin({ id: "1", role: "customer" }, true)).toBe(false);
    expect(canAdminOtpLogin({ id: "1", role: "admin" }, false)).toBe(false);
    expect(canAdminOtpLogin(null, true)).toBe(false);
    expect(canAdminOtpLogin({ id: "1", role: "admin" }, true)).toBe(true);
  });
});
