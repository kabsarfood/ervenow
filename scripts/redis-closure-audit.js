/**
 * Redis Closure Audit — jobs · retry · DLQ · stalled
 * Usage: node scripts/redis-closure-audit.js
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const QUEUE_NAME = process.env.BULLMQ_QUEUE_NAME || "ervenow-delivery";
const DLQ_NAME = process.env.BULLMQ_DLQ_NAME || "ervenow-delivery:dlq";

async function withRedis(fn) {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return { skipped: true, ok: false, message: "REDIS_URL missing" };
  const IORedis = require("ioredis");
  const conn = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  });
  try {
    await conn.connect();
    const pong = await conn.ping();
    if (pong !== "PONG") throw new Error("ping failed");
    const result = await fn(conn);
    await conn.quit();
    return { skipped: false, ok: true, result };
  } catch (e) {
    try {
      conn.disconnect();
    } catch (_) {}
    return { skipped: false, ok: false, message: e && e.message };
  }
}

async function auditQueue(conn, queueName) {
  const { Queue } = require("bullmq");
  const q = new Queue(queueName, {
    connection: conn,
  });
  try {
    const counts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
    const activeJobs = await q.getJobs(["active"], 0, 49, false);
    return { counts, activeJobs };
  } finally {
    await q.close();
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  const redisUrl = String(process.env.REDIS_URL || "").trim();
  const report = {
    generated_at: generatedAt,
    queue_name: QUEUE_NAME,
    dlq_name: DLQ_NAME,
    redis_url_configured: !!redisUrl,
    ping: { skipped: !redisUrl, ok: false },
    main_queue: null,
    dlq: null,
    retry_policy: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
    },
    stalled_jobs: [],
    verdict: "FAIL",
    notes: [],
  };

  if (!redisUrl) {
    report.notes.push("REDIS_URL غير مُعرّف — التدقيق التشغيلي غير متاح.");
    writeReport(report);
    console.log("[redis-audit] FAIL — REDIS_URL missing");
    process.exit(1);
  }

  const run = await withRedis(async (conn) => {
    const main = await auditQueue(conn, QUEUE_NAME);
    const dlq = await auditQueue(conn, DLQ_NAME);
    return { main, dlq };
  });

  report.ping = { skipped: run.skipped, ok: run.ok, message: run.message || null };

  if (!run.ok) {
    report.notes.push("فشل اتصال Redis: " + (run.message || "unknown"));
    writeReport(report);
    console.log("[redis-audit] FAIL — ping");
    process.exit(1);
  }

  const now = Date.now();
  const STALL_MS = 15 * 60 * 1000;
  report.main_queue = run.result.main.counts;
  report.dlq = run.result.dlq.counts;
  report.stalled_jobs = (run.result.main.activeJobs || [])
    .filter(function (j) {
      return now - Number(j.timestamp || 0) > STALL_MS;
    })
    .map(function (j) {
      return {
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
        timestamp: j.timestamp,
      };
    });

  const failed = Number((report.main_queue && report.main_queue.failed) || 0);
  const dlqWaiting = Number((report.dlq && report.dlq.waiting) || 0);
  const stalledN = report.stalled_jobs.length;

  report.summary = {
    jobs_waiting: Number((report.main_queue && report.main_queue.waiting) || 0),
    jobs_active: Number((report.main_queue && report.main_queue.active) || 0),
    jobs_delayed: Number((report.main_queue && report.main_queue.delayed) || 0),
    jobs_failed: failed,
    jobs_completed: Number((report.main_queue && report.main_queue.completed) || 0),
    dlq_waiting: dlqWaiting,
    stalled_count: stalledN,
    retry_attempts: report.retry_policy.attempts,
  };

  report.verdict = failed === 0 && dlqWaiting === 0 && stalledN === 0 ? "PASS" : "FAIL";
  if (failed > 0) report.notes.push("يوجد jobs في حالة failed على الطابور الرئيسي.");
  if (dlqWaiting > 0) report.notes.push("يوجد entries في DLQ.");
  if (stalledN > 0) report.notes.push("يوجد active jobs أقدم من 15 دقيقة (stalled heuristic).");

  writeReport(report);
  console.log("[redis-audit]", report.verdict, report.summary);
  process.exit(report.verdict === "PASS" ? 0 : 1);
}

function writeReport(report) {
  const jsonPath = path.join(__dirname, "..", "data", "redis-closure-audit.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(__dirname, "..", "docs", "REDIS-CLOSURE-AUDIT.md");
  const s = report.summary || {};
  const md =
    "# Redis Closure Audit\n\n" +
    "**التاريخ:** " +
    report.generated_at +
    "\n\n" +
    "## الحكم: **" +
    report.verdict +
    "**\n\n" +
    "| المقياس | القيمة |\n|---------|--------|\n" +
    "| Waiting | " +
    (s.jobs_waiting != null ? s.jobs_waiting : "—") +
    " |\n" +
    "| Active | " +
    (s.jobs_active != null ? s.jobs_active : "—") +
    " |\n" +
    "| Delayed | " +
    (s.jobs_delayed != null ? s.jobs_delayed : "—") +
    " |\n" +
    "| Failed | " +
    (s.jobs_failed != null ? s.jobs_failed : "—") +
    " |\n" +
    "| Completed (cached) | " +
    (s.jobs_completed != null ? s.jobs_completed : "—") +
    " |\n" +
    "| DLQ waiting | " +
    (s.dlq_waiting != null ? s.dlq_waiting : "—") +
    " |\n" +
    "| Stalled (active >15m) | " +
    (s.stalled_count != null ? s.stalled_count : "—") +
    " |\n" +
    "| Retry attempts | " +
    (s.retry_attempts != null ? s.retry_attempts : "—") +
    " |\n\n" +
    (report.notes.length ? report.notes.map((n) => "- " + n).join("\n") + "\n" : "");
  fs.writeFileSync(mdPath, md);
}

main().catch((err) => {
  console.error("[redis-audit] error:", err.message || err);
  process.exit(1);
});
