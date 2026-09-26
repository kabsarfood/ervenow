const { createServiceClient, isSupabaseTimeoutError } = require("../../shared/config/supabase");
const { sendWhatsApp } = require("./notify");
const { createBackgroundPause, STAGGER_MS } = require("../../shared/utils/backgroundPause");

const RETRY_INTERVAL_MS = 60 * 1000;
const RETRY_LIMIT = 10;
const MAX_ATTEMPTS = 3;
let workerTimer = null;
let running = false;

async function retryFailedNotifications(sb) {
  const { data: failed, error } = await sb
    .from("driver_notifications")
    .select("id,driver_id,phone,message,attempts,status,created_at")
    .eq("status", "failed")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(RETRY_LIMIT);
  if (error) {
    console.error("[retryFailedNotifications] fetch failed:", error.message || error);
    if (isSupabaseTimeoutError(error)) {
      const timeoutErr = new Error(error.message || "timeout");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
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
  const gate = createBackgroundPause({ staggerMs: STAGGER_MS.retryNotifications });
  workerTimer = setInterval(async () => {
    if (running || gate.shouldSkip()) return;
    running = true;
    try {
      await retryFailedNotifications(sb);
      gate.noteSuccess();
    } catch (e) {
      if (isSupabaseTimeoutError(e)) gate.noteTimeout();
      console.error("[retryNotifications] worker tick failed:", e && (e.message || e));
    } finally {
      running = false;
    }
  }, RETRY_INTERVAL_MS);
}

module.exports = { retryFailedNotifications, startRetryNotificationsWorker };
