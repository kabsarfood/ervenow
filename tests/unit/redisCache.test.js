describe("redisCache fail-fast", function () {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(function () {
    if (ORIGINAL_REDIS_URL) process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    else delete process.env.REDIS_URL;
    jest.resetModules();
  });

  test("cacheGetJson returns null quickly when redis is unreachable", async function () {
    process.env.REDIS_URL = "redis://127.0.0.1:6399";
    process.env.REDIS_CACHE_OP_TIMEOUT_MS = "400";
    process.env.REDIS_CACHE_COOLDOWN_MS = "1000";
    const { cacheGetJson } = require("../../shared/utils/redisCache");
    const t0 = Date.now();
    const hit = await cacheGetJson("storelist:test");
    expect(hit).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});
