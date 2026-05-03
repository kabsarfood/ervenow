const CircuitBreaker = require("opossum");
const { metrics } = require("./metrics");
const { recordOsrmFailure } = require("./alerts");
const { logger } = require("./logger");

const OSRM_ROUTER_BASE =
  String(process.env.OSRM_ROUTER_URL || "http://router.project-osrm.org").replace(/\/$/, "") ||
  "http://router.project-osrm.org";

/** مهلة طلب OSRM (افتراضي 1500 ms كما في المواصفات) */
const OSRM_TIMEOUT_MS = Math.min(10000, Math.max(300, Number(process.env.OSRM_CLIENT_TIMEOUT_MS || 1500)));

const MAX_CONCURRENT = Math.min(20, Math.max(1, Number(process.env.OSRM_MAX_CONCURRENT || 5)));

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const a1 = (Number(lat1) * Math.PI) / 180;
  const a2 = (Number(lat2) * Math.PI) / 180;
  const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180;
  const dLng = ((Number(lng2) - Number(lng1)) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a1) * Math.cos(a2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let active = 0;
const waiters = [];

async function withConcurrency(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

async function httpFetch(url, init) {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch(url, init);
  }
  return require("node-fetch")(url, init);
}

async function fetchOsrmKmOnce(coords) {
  const { flng, flat, tlng, tlat } = coords;
  const url = `${OSRM_ROUTER_BASE}/route/v1/driving/${flng},${flat};${tlng},${tlat}?overview=false`;
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), OSRM_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await httpFetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`osrm HTTP ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!data || data.code !== "Ok" || !data.routes || !data.routes[0]) throw new Error("osrm no route");
    const meters = data.routes[0].distance;
    if (!Number.isFinite(meters)) throw new Error("osrm bad distance");
    const ms = Date.now() - t0;
    metrics.osrmLatencyMs.observe(ms);
    metrics.osrmRequestsTotal.inc({ status: "success" });
    return meters / 1000;
  } catch (e) {
    const ms = Date.now() - t0;
    metrics.osrmLatencyMs.observe(ms);
    metrics.osrmRequestsTotal.inc({ status: "error" });
    recordOsrmFailure({ phase: "fetch", message: e && e.message });
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

const breaker = new CircuitBreaker((coords) => fetchOsrmKmOnce(coords), {
  timeout: OSRM_TIMEOUT_MS + 250,
  errorThresholdPercentage: 50,
  resetTimeout: Math.max(1000, Number(process.env.OSRM_CIRCUIT_RESET_MS) || 5000),
  rollingCountTimeout: 15000,
  volumeThreshold: 5,
});

breaker.on("open", () => {
  logger.warn("[osrm] circuit OPEN — using haversine fallback until reset");
});
breaker.on("halfOpen", () => {
  logger.info("[osrm] circuit halfOpen — trial request");
});

/**
 * مسافة بالكم: OSRM عبر circuit + حد التزامن؛ عند الفشل أو الفتح: Haversine.
 */
async function getOsrmRouteKmOrHaversine(from, to) {
  const flat = Number(from?.lat);
  const flng = Number(from?.lng);
  const tlat = Number(to?.lat);
  const tlng = Number(to?.lng);
  if (![flat, flng, tlat, tlng].every((x) => Number.isFinite(x))) {
    return NaN;
  }
  const coords = { flat, flng, tlat, tlng };
  const fallback = () => haversineKm(flat, flng, tlat, tlng);

  try {
    const km = await withConcurrency(() => breaker.fire(coords));
    if (Number.isFinite(km) && km >= 0) return km;
  } catch {
    /* circuit أو رفض */
  }
  return fallback();
}

module.exports = {
  getOsrmRouteKmOrHaversine,
  haversineKm,
  OSRM_TIMEOUT_MS,
  MAX_CONCURRENT,
};
