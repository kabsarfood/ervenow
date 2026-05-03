const client = require("prom-client");

const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: "ervenow_" });

const apiRequestsTotal = new client.Counter({
  name: "api_requests_total",
  help: "Total HTTP API requests handled",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const apiRequestDurationMs = new client.Histogram({
  name: "request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

const osrmRequestsTotal = new client.Counter({
  name: "osrm_requests_total",
  help: "Total OSRM routing attempts",
  labelNames: ["status"],
  registers: [register],
});

const osrmLatencyMs = new client.Histogram({
  name: "osrm_latency_ms",
  help: "OSRM HTTP round-trip latency in milliseconds",
  buckets: [50, 100, 200, 400, 800, 1200, 2000, 4000, 8000],
  registers: [register],
});

const queueJobsTotal = new client.Counter({
  name: "queue_jobs_total",
  help: "Delivery queue job lifecycle events",
  labelNames: ["job_name", "result"],
  registers: [register],
});

const errorsTotal = new client.Counter({
  name: "errors_total",
  help: "Application errors by source",
  labelNames: ["source"],
  registers: [register],
});

function normalizeRoute(pathname) {
  if (!pathname || pathname === "/") return pathname || "/";
  return String(pathname)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\d+/g, ":id");
}

function observeApiRequest(method, route, statusCode, durationMs) {
  const r = normalizeRoute(route || "");
  const status = String(statusCode || 0);
  apiRequestsTotal.inc({ method: method || "UNKNOWN", route: r, status });
  apiRequestDurationMs.observe({ method: method || "UNKNOWN", route: r }, Math.max(0, durationMs || 0));
}

module.exports = {
  register,
  metrics: {
    apiRequestsTotal,
    apiRequestDurationMs,
    osrmRequestsTotal,
    osrmLatencyMs,
    queueJobsTotal,
    errorsTotal,
    observeApiRequest,
    normalizeRoute,
  },
};
