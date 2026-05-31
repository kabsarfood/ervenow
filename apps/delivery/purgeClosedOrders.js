const { createServiceClient } = require("../../shared/config/supabase");
const { logger } = require("../../shared/utils/logger");

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_YEARS = 1;
const BATCH_SIZE = 100;
const CLOSED_STATUSES = ["delivered", "completed", "cancelled", "canceled"];

let workerTimer = null;
let running = false;

function cutoffIso() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - RETENTION_YEARS);
  return d.toISOString();
}

/**
 * حذف الطلبات المُسلّمة/المغلقة الأقدم من سنة — مرجع الزائر لا يُحفظ إلى الأبد.
 */
async function purgeClosedOrdersOlderThanOneYear(sb) {
  if (!sb) return { deleted: 0, skipped: true };

  const cutoff = cutoffIso();
  let totalDeleted = 0;

  for (;;) {
    const { data: rows, error: selErr } = await sb
      .from("orders")
      .select("id, order_number, delivery_status, updated_at, created_at")
      .in("delivery_status", CLOSED_STATUSES)
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (selErr) {
      logger.error({ err: selErr.message }, "[purgeClosedOrders] select failed");
      throw selErr;
    }
    if (!rows || !rows.length) break;

    const ids = rows.map((r) => r.id).filter(Boolean);
    if (!ids.length) break;

    const { error: delErr, count } = await sb.from("orders").delete({ count: "exact" }).in("id", ids);
    if (delErr) {
      logger.error({ err: delErr.message, batchSize: ids.length }, "[purgeClosedOrders] delete failed");
      throw delErr;
    }
    totalDeleted += Number(count) || ids.length;
    if (rows.length < BATCH_SIZE) break;
  }

  if (totalDeleted > 0) {
    logger.info({ deleted: totalDeleted, cutoff }, "[purgeClosedOrders] purged old closed orders");
  }
  return { deleted: totalDeleted, cutoff };
}

function startClosedOrdersPurgeWorker() {
  if (workerTimer) return;
  const sb = createServiceClient();
  if (!sb) {
    logger.warn("[purgeClosedOrders] skipped: service supabase is not configured");
    return;
  }

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await purgeClosedOrdersOlderThanOneYear(sb);
    } catch (e) {
      logger.error({ err: e && (e.message || String(e)) }, "[purgeClosedOrders] worker tick failed");
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 60 * 1000);
  workerTimer = setInterval(tick, PURGE_INTERVAL_MS);
}

module.exports = {
  purgeClosedOrdersOlderThanOneYear,
  startClosedOrdersPurgeWorker,
  RETENTION_YEARS,
};
