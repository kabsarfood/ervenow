const fs = require("fs");
const path = require("path");
const { resolvePostLoginPath, resolvePortalRole } = require("../../shared/utils/resolvePortalRole");

const PUBLIC = path.join(__dirname, "../../public");

function readPublic(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), "utf8");
}

describe("unified public login entry", () => {
  test("legacy partner login pages redirect to /login with a role hint", () => {
    const driver = readPublic("driver-login.html");
    const service = readPublic("service-provider-login.html");
    const delivery = readPublic("delivery/login.html");
    expect(driver).toMatch(/\/login\?role=driver/);
    expect(service).toMatch(/\/login\?role=service/);
    expect(delivery).toMatch(/\/login\?role=driver/);
    expect(driver).not.toMatch(/\/api\/driver\/send-otp/);
    expect(driver).not.toMatch(/\/api\/driver\/verify-otp/);
    expect(service).not.toMatch(/login_only:\s*true/);
  });

  test("public /login no longer bounces existing users to partner OTP pages", () => {
    const login = readPublic("login.html");
    expect(login).not.toMatch(/location\.replace\("\/driver-login"\)/);
    expect(login).not.toMatch(/location\.replace\("\/service-provider-login"\)/);
    expect(login).toMatch(/أريد الطلب من ERVENOW/);
    expect(login).toMatch(/أريد التسجيل كمتجر/);
    expect(login).toMatch(/أريد العمل كمندوب/);
    expect(login).toMatch(/أريد تقديم خدمة/);
    expect(login).not.toMatch(/dests\.length > 1/);
  });

  test("existing account destination follows stored role, not a URL hint", () => {
    expect(resolvePortalRole({ role: "driver" }).portalRole).toBe("driver");
    expect(resolvePostLoginPath({ role: "driver" })).toBe("/driver-preview");
    expect(resolvePostLoginPath({ role: "store" })).toBe("/merchant-preview");
    expect(resolvePostLoginPath({ role: "customer" })).toBe("/");
    expect(resolvePostLoginPath({ role: "service", service_type: "plumber" })).toBe("/service-preview");
    expect(resolvePostLoginPath({ role: "service", service_type: "pickup_truck" })).toBe("/transport-preview");
    expect(resolvePostLoginPath({ role: "admin" })).toBe("/admin-dashboard");
  });
});
