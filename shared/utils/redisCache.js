/**
 * كاش اختياري عبر Redis (REDIS_URL). بدون Redis يُعاد null دائماً من get.
 */
let client = null;
let clientDisabled = false;

function getClient() {
  if (clientDisabled) return null;
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  if (!client) {
    try {
      const Redis = require("ioredis");
      client = new Redis(url, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      client.on("error", (err) => {
        console.warn("[redisCache]", err && (err.message || err));
      });
    } catch (e) {
      clientDisabled = true;
      console.warn("[redisCache] disabled:", e && (e.message || e));
      return null;
    }
  }
  return client;
}

async function cacheGet(key) {
  const r = getClient();
  if (!r) return null;
  try {
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => {});
    const raw = await r.get(String(key));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttlMs) {
  const r = getClient();
  if (!r) return false;
  try {
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => {});
    const ttl = Math.max(1, Math.floor(Number(ttlMs) || 60_000));
    await r.set(String(key), String(value), "PX", ttl);
    return true;
  } catch {
    return false;
  }
}

async function cacheGetJson(key) {
  const r = getClient();
  if (!r) return null;
  try {
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => {});
    const raw = await r.get(String(key));
    if (raw == null || raw === "") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function cacheSetJson(key, obj, ttlMs) {
  const r = getClient();
  if (!r) return false;
  try {
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => {});
    const ttl = Math.max(1, Math.floor(Number(ttlMs) || 60_000));
    await r.set(String(key), JSON.stringify(obj), "PX", ttl);
    return true;
  } catch {
    return false;
  }
}

module.exports = { cacheGet, cacheSet, cacheGetJson, cacheSetJson, getClient };
