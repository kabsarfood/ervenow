require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { processDeliveryJob } = require("./deliveryProcessor");
const { getDlqQueue } = require("../queues/deliveryQueue");
const { logger } = require("../shared/utils/logger");
const { metrics } = require("../shared/utils/metrics");
const { recordQueueDelay, recordFinalJobFailure } = require("../shared/utils/alerts");

const QUEUE_NAME = process.env.BULLMQ_QUEUE_NAME || "ervenow-delivery";
const url = String(process.env.REDIS_URL || "").trim();

if (!url) {
  logger.error("REDIS_URL مطلوب لتشغيل العامل");
  process.exit(1);
}

const connection = new IORedis(url, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const delayMs = Date.now() - job.timestamp;
    recordQueueDelay(delayMs, { jobName: job.name, jobId: job.id });
    await processDeliveryJob(job.name, job.data);
  },
  {
    connection,
    concurrency: Math.max(1, Math.min(20, Number(process.env.BULLMQ_WORKER_CONCURRENCY) || 5)),
  }
);

worker.on("completed", (job) => {
  metrics.queueJobsTotal.inc({ job_name: String(job.name || "unknown"), result: "completed" });
  logger.info({ jobName: job.name, jobId: job.id }, "deliveryWorker.completed");
});

worker.on("failed", (job, err) => {
  metrics.queueJobsTotal.inc({ job_name: job && job.name ? String(job.name) : "unknown", result: "failed_event" });
  metrics.errorsTotal.inc({ source: "delivery_worker" });
  logger.error(
    { jobName: job && job.name, jobId: job && job.id, err: err && (err.message || String(err)) },
    "deliveryWorker.failed"
  );

  if (!job) return;
  const maxAttempts = job.opts && job.opts.attempts != null ? Number(job.opts.attempts) : 5;
  const attemptsMade = Number(job.attemptsMade) || 0;
  if (attemptsMade < maxAttempts) return;

  void (async () => {
    try {
      const dlq = getDlqQueue();
      if (dlq) {
        await dlq.add("failed-job", job.data);
        metrics.queueJobsTotal.inc({ job_name: String(job.name || "unknown"), result: "dlq" });
      }
    } catch (e) {
      logger.error({ err: e && (e.message || String(e)), jobId: job.id }, "deliveryWorker.dlq_enqueue_failed");
    }
    recordFinalJobFailure({ jobName: job.name, jobId: job.id });
  })();
});

logger.info({ queue: QUEUE_NAME }, "deliveryWorker.listening");
