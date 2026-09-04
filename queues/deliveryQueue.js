const IORedis = require("ioredis");

const QUEUE_NAME = process.env.BULLMQ_QUEUE_NAME || "ervenow-delivery";
const DLQ_NAME = process.env.BULLMQ_DLQ_NAME || "ervenow-delivery:dlq";

const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

let connection = null;
let queueInstance = null;
let dlqInstance = null;

function getConnection() {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  if (!connection) {
    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      connectTimeout: 2000,
      commandTimeout: 3000,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 4) return null;
        return Math.min(times * 200, 1500);
      },
    });
    connection.on("error", (err) => {
      const { logger } = require("../shared/utils/logger");
      logger.warn({ err: err && err.message }, "redis.connection_error");
    });
  }
  return connection;
}

async function pingRedis() {
  const conn = getConnection();
  if (!conn) return { skipped: true, ok: false, required: false };
  try {
    if (conn.status === "wait") {
      await Promise.race([
        conn.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("redis_connect_timeout")), 2000)),
      ]).catch(() => {});
    }
    const pong = await Promise.race([
      conn.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("redis_ping_timeout")), 1500)),
    ]);
    return { skipped: false, ok: pong === "PONG", required: false };
  } catch (e) {
    return { skipped: false, ok: false, required: false, message: e && e.message };
  }
}

function getQueue() {
  const conn = getConnection();
  if (!conn) return null;
  if (!queueInstance) {
    const { Queue } = require("bullmq");
    queueInstance = new Queue(QUEUE_NAME, { connection: conn });
  }
  return queueInstance;
}

function getDlqQueue() {
  const conn = getConnection();
  if (!conn) return null;
  if (!dlqInstance) {
    const { Queue } = require("bullmq");
    dlqInstance = new Queue(DLQ_NAME, { connection: conn });
  }
  return dlqInstance;
}

/**
 * إضافة مهمة توصيل. بدون REDIS_URL يُنفَّذ المعالج inline (setImmediate) للتطوير المحلي.
 */
async function enqueueDeliveryJob(name, data, opts) {
  const { metrics } = require("../shared/utils/metrics");
  const { logger } = require("../shared/utils/logger");

  const q = getQueue();
  if (!q) {
    const { processDeliveryJob } = require("./deliveryProcessor");
    metrics.queueJobsTotal.inc({ job_name: String(name || "unknown"), result: "inline" });
    setImmediate(() => {
      processDeliveryJob(name, data).catch((err) => {
        metrics.queueJobsTotal.inc({ job_name: String(name || "unknown"), result: "inline_failed" });
        metrics.errorsTotal.inc({ source: "delivery_queue_inline" });
        logger.error({ err: err && (err.message || String(err)), jobName: name }, "deliveryQueue.inline_failed");
      });
    });
    return { queued: false, mode: "inline" };
  }

  try {
    await Promise.race([
      q.add(name, data, {
        ...DEFAULT_JOB_OPTS,
        ...(opts || {}),
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("redis_enqueue_timeout")), 2000);
      }),
    ]);
  } catch (err) {
    logger.warn(
      { err: err && (err.message || String(err)), jobName: name },
      "deliveryQueue.enqueue_failed_fallback_inline"
    );
    const { processDeliveryJob } = require("./deliveryProcessor");
    metrics.queueJobsTotal.inc({ job_name: String(name || "unknown"), result: "inline_fallback" });
    setImmediate(() => {
      processDeliveryJob(name, data).catch((procErr) => {
        metrics.queueJobsTotal.inc({ job_name: String(name || "unknown"), result: "inline_failed" });
        metrics.errorsTotal.inc({ source: "delivery_queue_inline" });
        logger.error(
          { err: procErr && (procErr.message || String(procErr)), jobName: name },
          "deliveryQueue.inline_failed"
        );
      });
    });
    return { queued: false, mode: "inline_fallback" };
  }
  metrics.queueJobsTotal.inc({ job_name: String(name || "unknown"), result: "queued" });
  return { queued: true, mode: "bullmq" };
}

module.exports = {
  enqueueDeliveryJob,
  QUEUE_NAME,
  DLQ_NAME,
  getConnection,
  getQueue,
  getDlqQueue,
  pingRedis,
  DEFAULT_JOB_OPTS,
};
