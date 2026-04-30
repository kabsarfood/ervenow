const { createServiceClient } = require("../../shared/config/supabase");
const { sendWhatsApp } = require("./notify");

const RETRY_INTERVAL_MS = 30 * 1000;
const RETRY_LIMIT = 10;
const MAX_ATTEMPTS = 3;
let workerTimer = null;
let running = false;

async function retryFailedNotifications(sb) {
  const { data: failed, error } = await sb
    .from("driver_notifications")
    .select("*")
    .eq("status", "failed")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(RETRY_LIMIT);
  if (error) {
    console.error("[retryFailedNotifications] fetch failed:", error.message || error);
    return;
  }
  for (const n of failed || []) {
    try {
      await sendWhatsApp(n.phone, "🚚 لديك طلب جديد (إعادة إرسال)");
      await sb
        .from("driver_notifications")
        .update({
          status: "sent",
          attempts: Number(n.attempts || 0) + 1,
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", n.id);
    } catch (e) {
      await sb
        .from("driver_notifications")
        .update({
          attempts: Number(n.attempts || 0) + 1,
          error: String(e && (e.message || e) || "Retry failed"),
        })
        .eq("id", n.id);
    }
  }
}

function startRetryNotificationsWorker() {
  if (workerTimer) return;
  const sb = createServiceClient();
  if (!sb) {
    console.warn("[retryNotifications] skipped: service supabase is not configured");
    return;
  }
  workerTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await retryFailedNotifications(sb);
    } catch (e) {
      console.error("[retryNotifications] worker tick failed:", e && (e.message || e));
    } finally {
      running = false;
    }
  }, RETRY_INTERVAL_MS);
}

module.exports = { retryFailedNotifications, startRetryNotificationsWorker };
