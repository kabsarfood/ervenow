const {
  resolvePortalRole,
  portalPathForRole,
  resolvePostLoginPath,
  isTransportPortalType,
  isServicePortalType,
} = require("../../shared/utils/resolvePortalRole");

describe("resolvePortalRole", () => {
  test("maps unified portal roles from db role", () => {
    expect(resolvePortalRole({ role: "customer" }).portalRole).toBe("customer");
    expect(resolvePortalRole({ role: "user" }).portalRole).toBe("customer");
    expect(resolvePortalRole({ role: "driver" }).portalRole).toBe("driver");
    expect(resolvePortalRole({ role: "admin" }).portalRole).toBe("admin");
    expect(resolvePortalRole({ role: "store" }).portalRole).toBe("merchant");
    expect(resolvePortalRole({ role: "merchant" }).portalRole).toBe("merchant");
    expect(resolvePortalRole({ role: "restaurant" }).portalRole).toBe("merchant");
  });

  test("splits service vs transport by service_type", () => {
    expect(resolvePortalRole({ role: "service", service_type: "electrician" }).portalRole).toBe("service");
    expect(resolvePortalRole({ role: "service", service_type: "plumber" }).portalRole).toBe("service");
    expect(resolvePortalRole({ role: "service", service_type: "pickup_truck" }).portalRole).toBe("transport");
    expect(resolvePortalRole({ role: "service", service_type: "car_transport" }).portalRole).toBe("transport");
    expect(resolvePortalRole({ role: "service", service_type: "gas_delivery" }).portalRole).toBe("transport");
  });

  test("defaults service role without service_type to service portal", () => {
    expect(resolvePortalRole({ role: "service" }).portalRole).toBe("service");
  });

  test("unknown service type falls back to customer without blocking", () => {
    const r = resolvePortalRole({ role: "service", service_type: "mystery_type" });
    expect(r.portalRole).toBe("customer");
    expect(r.unknownServiceType).toBe(true);
  });

  test("unknown db role falls back to customer and flags unknownRole", () => {
    const r = resolvePortalRole({ role: "alien_role" });
    expect(r.portalRole).toBe("customer");
    expect(r.unknownRole).toBe(true);
  });

  test("blocked users route to complaints page", () => {
    expect(resolvePostLoginPath({ role: "blocked" })).toBe("/blocked-complaints");
  });

  test("live portal paths for operational roles", () => {
    expect(portalPathForRole("customer")).toBe("/start-now.html");
    expect(portalPathForRole("merchant")).toBe("/merchant-preview");
    expect(portalPathForRole("driver")).toBe("/driver-preview");
    expect(portalPathForRole("service")).toBe("/service-preview");
    expect(portalPathForRole("transport")).toBe("/transport-preview");
    expect(portalPathForRole("admin")).toBe("/admin-dashboard");
    expect(resolvePostLoginPath({ role: "customer" })).toBe("/start-now.html");
    expect(resolvePostLoginPath({ role: "service", service_type: "pickup_truck" })).toBe("/transport-preview");
    expect(resolvePostLoginPath({ role: "driver" })).toBe("/driver-preview");
    expect(resolvePostLoginPath({ role: "store" })).toBe("/merchant-preview");
  });

  test("type helpers", () => {
    expect(isTransportPortalType("pickup_truck")).toBe(true);
    expect(isTransportPortalType("electrician")).toBe(false);
    expect(isServicePortalType("ac_technician")).toBe(true);
    expect(isServicePortalType("car_transport")).toBe(false);
  });
});
