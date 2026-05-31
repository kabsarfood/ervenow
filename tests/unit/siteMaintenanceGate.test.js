const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isMaintenanceHostname,
  maintenanceActiveForRequest,
  getMaintenanceHostnames,
} = require("../../shared/middleware/siteMaintenanceGate");

test("site maintenance applies only on production hosts", () => {
  assert.equal(isMaintenanceHostname("www.ervenow.com"), true);
  assert.equal(isMaintenanceHostname("ervenow.com"), true);
  assert.equal(isMaintenanceHostname("localhost"), false);
  assert.equal(isMaintenanceHostname("127.0.0.1"), false);
  assert.equal(isMaintenanceHostname("staging.example.com"), false);
});

test("maintenanceActiveForRequest respects hostname", () => {
  assert.equal(maintenanceActiveForRequest({ hostname: "www.ervenow.com" }), true);
  assert.equal(maintenanceActiveForRequest({ hostname: "localhost" }), false);
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
