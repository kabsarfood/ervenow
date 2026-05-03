const { logger } = require("./logger");

const WINDOW_MS = 60_000;
const OSRM_FAIL_THRESHOLD = Math.max(1, Number(process.env.ALERT_OSRM_FAIL_THRESHOLD) || 10);
const QUEUE_DELAY_THRESHOLD_MS = Math.max(1000, Number(process.env.ALERT_QUEUE_DELAY_MS) || 5000);
const JOB_FAIL_THRESHOLD = Math.max(1, Number(process.env.ALERT_JOB_FAIL_THRESHOLD) || 5);

const osrmFailTimestamps = [];
const jobFailTimestamps = [];

function prune(tsArr, now) {
  return tsArr.filter((t) => now - t < WINDOW_MS);
}

function maybeWebhook(payload) {
  const url = String(process.env.ALERT_WEBHOOK_URL || "").trim();
  if (!url || typeof fetch !== "function") return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function trigger(type, detail = {}) {
  const merged = { type, ts: new Date().toISOString(), ...detail };
  logger.warn(merged, "ALERT");
  maybeWebhook(merged);
}

/** Call when an OSRM HTTP attempt fails (non-2xx / exception before fallback). */
function recordOsrmFailure(meta = {}) {
  const now = Date.now();
  osrmFailTimestamps.push(now);
  const pruned = prune(osrmFailTimestamps, now);
  osrmFailTimestamps.length = 0;
  osrmFailTimestamps.push(...pruned);
  if (pruned.length >= OSRM_FAIL_THRESHOLD) {
    trigger("osrm_failures_high", { count: pruned.length, ...meta });
  }
}

/** Call when a BullMQ job waits longer than threshold before processing starts. */
function recordQueueDelay(delayMs, meta = {}) {
  if (delayMs >= QUEUE_DELAY_THRESHOLD_MS) {
    trigger("queue_delay_high", { delayMs, thresholdMs: QUEUE_DELAY_THRESHOLD_MS, ...meta });
  }
}

/** Call when a job reaches failed state after exhausting retries. */
function recordFinalJobFailure(meta = {}) {
  const now = Date.now();
  jobFailTimestamps.push(now);
  const pruned = prune(jobFailTimestamps, now);
  jobFailTimestamps.length = 0;
  jobFailTimestamps.push(...pruned);
  if (pruned.length >= JOB_FAIL_THRESHOLD) {
    trigger("job_failures_high", { count: pruned.length, ...meta });
  }
}

module.exports = {
  trigger,
  recordOsrmFailure,
  recordQueueDelay,
  recordFinalJobFailure,
  OSRM_FAIL_THRESHOLD,
  QUEUE_DELAY_THRESHOLD_MS,
  JOB_FAIL_THRESHOLD,
};
