/**
 * كاش اختياري عبر Redis (REDIS_URL). بدون Redis يُعاد null دائماً من get.
 * عند تعذّر الاتصال يُعطّل مؤقتاً حتى لا يُعلّق مسارات API (مثل /api/stores).
 */
let client = null;
let clientDisabled = false;
let redisUnavailableUntil = 0;

const REDIS_OP_TIMEOUT_MS = Math.max(
  500,
  Math.min(5000, Number(process.env.REDIS_CACHE_OP_TIMEOUT_MS) || 1500)
);
const REDIS_COOLDOWN_MS = Math.max(
  5000,
  Math.min(120_000, Number(process.env.REDIS_CACHE_COOLDOWN_MS) || 30_000)
);

function markRedisUnavailable() {
  redisUnavailableUntil = Date.now() + REDIS_COOLDOWN_MS;
  if (client) {
    try {
      client.disconnect();
    } catch (_) {
      /* ignore */
    }
    client = null;
  }
}

function redisIsCoolingDown() {
  return Date.now() < redisUnavailableUntil;
}

function getClient() {
  if (clientDisabled || redisIsCoolingDown()) return null;
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  if (!client) {
    try {
      const Redis = require("ioredis");
      client = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: REDIS_OP_TIMEOUT_MS,
        enableOfflineQueue: false,
        retryStrategy: function () {
          return null;
        },
      });
      client.on("error", function (err) {
        console.warn("[redisCache]", err && (err.message || err));
        markRedisUnavailable();
      });
    } catch (e) {
      clientDisabled = true;
      console.warn("[redisCache] disabled:", e && (e.message || e));
      return null;
    }
  }
  return client;
}

async function withRedisOp(fn, fallback) {
  if (redisIsCoolingDown()) return fallback;
  const r = getClient();
  if (!r) return fallback;
  try {
    if (r.status === "wait" || r.status === "end") {
      await Promise.race([
        r.connect(),
        new Promise(function (_, reject) {
          setTimeout(function () {
            reject(new Error("REDIS_CONNECT_TIMEOUT"));
          }, REDIS_OP_TIMEOUT_MS);
        }),
      ]);
    }
    return await Promise.race([
      fn(r),
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error("REDIS_OP_TIMEOUT"));
        }, REDIS_OP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    markRedisUnavailable();
    return fallback;
  }
}

async function cacheGet(key) {
  const raw = await withRedisOp(function (r) {
    return r.get(String(key));
  }, null);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function cacheSet(key, value, ttlMs) {
  const ok = await withRedisOp(function (r) {
    const ttl = Math.max(1, Math.floor(Number(ttlMs) || 60_000));
    return r.set(String(key), String(value), "PX", ttl);
  }, null);
  return ok != null;
}

async function cacheGetJson(key) {
  const raw = await withRedisOp(function (r) {
    return r.get(String(key));
  }, null);
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function cacheSetJson(key, obj, ttlMs) {
  const ok = await withRedisOp(function (r) {
    const ttl = Math.max(1, Math.floor(Number(ttlMs) || 60_000));
    return r.set(String(key), JSON.stringify(obj), "PX", ttl);
  }, null);
  return ok != null;
}

module.exports = { cacheGet, cacheSet, cacheGetJson, cacheSetJson, getClient };
