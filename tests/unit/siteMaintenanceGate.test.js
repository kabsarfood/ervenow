const test = require("node:test");
const assert = require("node:assert/strict");
const store = require("../../shared/utils/siteMaintenanceStore");
const {
  isMaintenanceHostname,
  isDevelopmentHost,
  maintenanceActiveForRequest,
  getMaintenanceHostnames,
  shouldBlockPublicPage,
} = require("../../shared/middleware/siteMaintenanceGate");

test("development hosts never receive maintenance", () => {
  assert.equal(isDevelopmentHost("localhost"), true);
  assert.equal(isDevelopmentHost("127.0.0.1"), true);
  assert.equal(isDevelopmentHost("::1"), true);
  assert.equal(isDevelopmentHost("192.168.1.42"), true);
  assert.equal(isDevelopmentHost("10.0.0.5"), true);
  assert.equal(isDevelopmentHost("mybox.local"), true);
  assert.equal(isDevelopmentHost("www.ervenow.com"), false);
});

test("site maintenance applies only on production hosts", () => {
  assert.equal(isMaintenanceHostname("www.ervenow.com"), true);
  assert.equal(isMaintenanceHostname("ervenow.com"), true);
  assert.equal(isMaintenanceHostname("localhost"), false);
  assert.equal(isMaintenanceHostname("127.0.0.1"), false);
  assert.equal(isMaintenanceHostname("192.168.0.1"), false);
  assert.equal(isMaintenanceHostname("staging.example.com"), false);
});

test("maintenanceActiveForRequest respects hostname", () => {
  assert.equal(maintenanceActiveForRequest({ hostname: "www.ervenow.com" }), true);
  assert.equal(
    maintenanceActiveForRequest({ hostname: "www.ervenow.com", headers: { host: "localhost:4000" } }),
    false
  );
  assert.equal(maintenanceActiveForRequest({ hostname: "localhost" }), false);
  assert.equal(
    maintenanceActiveForRequest({ headers: { host: "localhost:4000" } }),
    false
  );
});

test("default maintenance hostnames include apex and www", () => {
  const prev = process.env.SITE_MAINTENANCE_HOSTS;
  delete process.env.SITE_MAINTENANCE_HOSTS;
  delete require.cache[require.resolve("../../shared/middleware/siteMaintenanceGate")];
  const mod = require("../../shared/middleware/siteMaintenanceGate");
  const hosts = mod.getMaintenanceHostnames();
  assert.ok(hosts.includes("ervenow.com"));
  assert.ok(hosts.includes("www.ervenow.com"));
  if (prev === undefined) delete process.env.SITE_MAINTENANCE_HOSTS;
  else process.env.SITE_MAINTENANCE_HOSTS = prev;
  delete require.cache[require.resolve("../../shared/middleware/siteMaintenanceGate")];
});

test("shouldBlockPublicPage: production HTML blocked when maintenance on", () => {
  const prev = store.readState;
  store.readState = () => true;
  try {
    assert.equal(
      shouldBlockPublicPage({
        method: "GET",
        path: "/",
        hostname: "ervenow.com",
        headers: { host: "ervenow.com" },
      }),
      true
    );
    assert.equal(
      shouldBlockPublicPage({
        method: "GET",
        path: "/",
        hostname: "localhost",
        headers: { host: "localhost:4000" },
      }),
      false
    );
    assert.equal(
      shouldBlockPublicPage({
        method: "GET",
        path: "/api/health",
        hostname: "ervenow.com",
        headers: { host: "ervenow.com" },
      }),
      false
    );
    assert.equal(
      shouldBlockPublicPage({
        method: "GET",
        path: "/admin-dashboard",
        hostname: "ervenow.com",
        headers: { host: "ervenow.com" },
      }),
      false
    );
  } finally {
    store.readState = prev;
  }
});

test("shouldBlockPublicPage: off when maintenance disabled", () => {
  const prev = store.readState;
  store.readState = () => false;
  try {
    assert.equal(
      shouldBlockPublicPage({
        method: "GET",
        path: "/",
        hostname: "ervenow.com",
        headers: { host: "ervenow.com" },
      }),
      false
    );
  } finally {
    store.readState = prev;
  }
});
