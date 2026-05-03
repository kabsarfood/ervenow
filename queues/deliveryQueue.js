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
    });
  }
  return connection;
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

  await q.add(name, data, {
    ...DEFAULT_JOB_OPTS,
    ...(opts || {}),
  });
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
  DEFAULT_JOB_OPTS,
};
