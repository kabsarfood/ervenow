const store = require("../../shared/utils/siteMaintenanceStore");
const {
  isMaintenanceHostname,
  isDevelopmentHost,
  maintenanceActiveForRequest,
  getMaintenanceHostnames,
  shouldBlockPublicPage,
} = require("../../shared/middleware/siteMaintenanceGate");

describe("siteMaintenanceGate", () => {
  test("development hosts never receive maintenance", () => {
    expect(isDevelopmentHost("localhost")).toBe(true);
    expect(isDevelopmentHost("127.0.0.1")).toBe(true);
    expect(isDevelopmentHost("::1")).toBe(true);
    expect(isDevelopmentHost("192.168.1.42")).toBe(true);
    expect(isDevelopmentHost("10.0.0.5")).toBe(true);
    expect(isDevelopmentHost("mybox.local")).toBe(true);
    expect(isDevelopmentHost("www.ervenow.com")).toBe(false);
  });

  test("site maintenance applies only on production hosts", () => {
    expect(isMaintenanceHostname("www.ervenow.com")).toBe(true);
    expect(isMaintenanceHostname("ervenow.com")).toBe(true);
    expect(isMaintenanceHostname("localhost")).toBe(false);
    expect(isMaintenanceHostname("127.0.0.1")).toBe(false);
    expect(isMaintenanceHostname("192.168.0.1")).toBe(false);
    expect(isMaintenanceHostname("staging.example.com")).toBe(false);
  });

  test("maintenanceActiveForRequest respects hostname", () => {
    expect(maintenanceActiveForRequest({ hostname: "www.ervenow.com" })).toBe(true);
    expect(
      maintenanceActiveForRequest({ hostname: "www.ervenow.com", headers: { host: "localhost:4000" } })
    ).toBe(false);
    expect(maintenanceActiveForRequest({ hostname: "localhost" })).toBe(false);
    expect(maintenanceActiveForRequest({ headers: { host: "localhost:4000" } })).toBe(false);
  });

  test("default maintenance hostnames include apex and www", () => {
    const prev = process.env.SITE_MAINTENANCE_HOSTS;
    delete process.env.SITE_MAINTENANCE_HOSTS;
    delete require.cache[require.resolve("../../shared/middleware/siteMaintenanceGate")];
    const mod = require("../../shared/middleware/siteMaintenanceGate");
    const hosts = mod.getMaintenanceHostnames();
    expect(hosts).toContain("ervenow.com");
    expect(hosts).toContain("www.ervenow.com");
    if (prev === undefined) delete process.env.SITE_MAINTENANCE_HOSTS;
    else process.env.SITE_MAINTENANCE_HOSTS = prev;
    delete require.cache[require.resolve("../../shared/middleware/siteMaintenanceGate")];
  });

  test("shouldBlockPublicPage: production HTML blocked when maintenance on", () => {
    const prev = store.readState;
    store.readState = () => true;
    try {
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(true);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/delivery-services.html",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(true);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/delivery-services",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(true);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/admin-login",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(true);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/",
          hostname: "localhost",
          headers: { host: "localhost:4000" },
        })
      ).toBe(false);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/api/health",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(false);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/assets/viewport-fit.js",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(false);
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/admin-dashboard",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(false);
    } finally {
      store.readState = prev;
    }
  });

  test("shouldBlockPublicPage: off when maintenance disabled", () => {
    const prev = store.readState;
    store.readState = () => false;
    try {
      expect(
        shouldBlockPublicPage({
          method: "GET",
          path: "/",
          hostname: "ervenow.com",
          headers: { host: "ervenow.com" },
        })
      ).toBe(false);
    } finally {
      store.readState = prev;
    }
  });
});
