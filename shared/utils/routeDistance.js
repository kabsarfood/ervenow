const { roughDistanceKm } = require("./geo");
const { getOsrmRouteKmOrHaversine } = require("./osrmClient");
const { cacheGet, cacheSet } = require("./redisCache");

const ROUTE_CACHE_TTL_MS = Number(process.env.ROUTE_CACHE_TTL_MS || 120000);
const routeCache = new Map();

function makeKey(a, b) {
  const r = (x) => Math.round(x * 1000) / 1000;
  return `${r(a.lat)},${r(a.lng)}|${r(b.lat)},${r(b.lng)}`;
}

function getCached(a, b) {
  const key = makeKey(a, b);
  const hit = routeCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return hit.km;
}

function setCached(a, b, km) {
  const key = makeKey(a, b);
  routeCache.set(key, { km, ts: Date.now() });
}

/**
 * مسافة بالكم: كاش (ذاكرة + Redis) ثم osrmClient (دائرة حماية + تزامن + Haversine).
 */
async function getRouteDistanceKm(from, to) {
  const flat = Number(from?.lat);
  const flng = Number(from?.lng);
  const tlat = Number(to?.lat);
  const tlng = Number(to?.lng);
  if (![flat, flng, tlat, tlng].every((x) => Number.isFinite(x))) return null;

  const fromPt = { lat: flat, lng: flng };
  const toPt = { lat: tlat, lng: tlng };
  const redisKey = `route:v1:${makeKey(fromPt, toPt)}`;

  const mem = getCached(fromPt, toPt);
  if (mem != null) return mem;

  const redisKm = await cacheGet(redisKey);
  if (redisKm != null && Number.isFinite(redisKm)) {
    setCached(fromPt, toPt, redisKm);
    return redisKm;
  }

  const km = await getOsrmRouteKmOrHaversine(fromPt, toPt);
  if (km != null && Number.isFinite(km)) {
    if (km) setCached(fromPt, toPt, km);
    await cacheSet(redisKey, km, ROUTE_CACHE_TTL_MS);
    return km;
  }

  const rough = roughDistanceKm(flat, flng, tlat, tlng);
  return Number.isFinite(rough) ? rough : null;
}

async function routeKmWithRoughFallback(lat1, lng1, lat2, lng2) {
  let km = await getRouteDistanceKm({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lat2 });
  if (km == null || !Number.isFinite(km)) {
    km = roughDistanceKm(lat1, lng1, lat2, lng2);
  }
  return km;
}

function deliveryEtaMinutesFromKm(km) {
  if (!Number.isFinite(km) || km < 0) return null;
  return Math.max(10, Math.round((km / 40) * 60));
}

module.exports = {
  getRouteDistanceKm,
  routeKmWithRoughFallback,
  deliveryEtaMinutesFromKm,
  makeRouteCacheKey: makeKey,
};
