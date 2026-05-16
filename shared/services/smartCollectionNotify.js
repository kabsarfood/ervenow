/**
 * Smart Collection — تنبيهات المندوب عند عمولة COD (إضافة فقط، لا تغيّر دفتر العمولة).
 */

const { normalizePhone, normalizeDigits } = require("../utils/phone");
const { logger } = require("../utils/logger");
const { getDriverCommissionBalance, isCodOrder } = require("./driverCommissionLedger");

const COMMISSION_ALERT_THRESHOLD = (() => {
  const n = Number(process.env.SMART_COLLECTION_ALERT_BALANCE || process.env.DRIVER_COMMISSION_ALERT_AT);
  return Number.isFinite(n) && n > 0 ? n : 150;
})();

const CHANNEL = "commission_smart";
const THROTTLE_MS = 45 * 60 * 1000;
const throttleByDriver = new Map();

function waFromNotify() {
  const { sendWhatsApp } = require("../utils/whatsapp");
  return sendWhatsApp;
}

async function sendDriverWaMessage(phone, body, type) {
  const digits = normalizeDigits(phone);
  if (!digits) return false;
  try {
    const sendWhatsApp = waFromNotify();
    const ok = await sendWhatsApp({ to: digits, message: String(body || "") });
    if (ok) console.log("WHATSAPP SENT (smart-collection):", digits.slice(0, 4) + "***", type);
    return !!ok;
  } catch (e) {
    logger.warn({ err: e.message || String(e), type }, "[smart-collection] WA failed");
    return false;
  }
}

function buildDeliveryMessage(order, balance, commissionAmount) {
  const on = (order?.order_number && String(order.order_number).trim()) || String(order?.id || "").slice(0, 8);
  const comm =
    Number.isFinite(Number(commissionAmount)) && Number(commissionAmount) > 0
      ? `${Number(commissionAmount).toFixed(2)} ر.س`
      : "—";
  const bal = Number.isFinite(Number(balance)) ? `${Number(balance).toFixed(2)} ر.س` : "—";
  let body =
    `💰 ERVENOW — عمولة COD\n\n` +
    `تم تسليم الطلب ${on}.\n` +
    `عمولة هذا الطلب: ${comm}\n` +
    `إجمالي المستحق عليك: ${bal}\n\n` +
    `يرجى تسليم المبلغ للإدارة عند التحصيل.`;
  if (Number(balance) > COMMISSION_ALERT_THRESHOLD) {
    body +=
      `\n\n⚠️ تنبيه: تجاوزت ${COMMISSION_ALERT_THRESHOLD} ر.س — يرجى التحصيل في أقرب وقت لتجنب الحظر.`;
  }
  return body;
}

function buildThresholdMessage(balance) {
  const bal = Number(balance).toFixed(2);
  return (
    `⚠️ ERVENOW — تنبيه تحصيل عمولة\n\n` +
    `رصيدك المستحق: ${bal} ر.س\n` +
    `تجاوزت حد التنبيه (${COMMISSION_ALERT_THRESHOLD} ر.س).\n\n` +
    `يرجى مراجعة الإدارة لتسليم العمولة وتجنب إيقاف قبول الطلبات.`
  );
}

function shouldThrottle(driverUserId, kind) {
  const key = String(driverUserId || "") + ":" + kind;
  const now = Date.now();
  const last = Number(throttleByDriver.get(key) || 0);
  if (now - last < THROTTLE_MS) return true;
  throttleByDriver.set(key, now);
  return false;
}

async function resolveDriverForOrder(sb, order) {
  const userId = String(order?.driver_id || "").trim();
  if (!userId) return null;

  const { data: user } = await sb.from("users").select("id, phone").eq("id", userId).maybeSingle();
  const phoneDigits = normalizeDigits(user?.phone);
  if (!phoneDigits) return { user_id: userId, phone: null, driver_record_id: null, name: null };

  const { data: drivers } = await sb
    .from("drivers")
    .select("id, name, phone")
    .eq("phone", phoneDigits)
    .limit(3);
  let drv = (drivers || []).find((d) => normalizeDigits(d.phone) === phoneDigits);
  if (!drv && drivers?.length) drv = drivers[0];

  return {
    user_id: userId,
    phone: drv?.phone || user?.phone || phoneDigits,
    driver_record_id: drv?.id || null,
    name: drv?.name || null,
  };
}

async function logCommissionNotification(sb, row) {
  try {
    await sb.from("driver_notifications").insert(row);
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, "[smart-collection] log notification");
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order
 * @param {object} [commResult] نتيجة applyDriverCommissionOnDelivered
 */
async function notifySmartCollectionOnDelivered(sb, order, commResult) {
  if (!sb || !order?.id || !order?.driver_id) return { skipped: true, reason: "no_driver" };
  if (!isCodOrder(order)) return { skipped: true, reason: "not_cod" };
  if (commResult && commResult.reason === "migration_missing") {
    return { skipped: true, reason: "migration_missing" };
  }

  const driver = await resolveDriverForOrder(sb, order);
  if (!driver?.phone) return { skipped: true, reason: "no_phone" };

  const balance = await getDriverCommissionBalance(sb, driver.user_id);
  const commissionAmount =
    commResult?.commission != null
      ? Number(commResult.commission)
      : commResult?.amount != null
        ? Number(commResult.amount)
        : null;

  const results = [];

  if (!shouldThrottle(driver.user_id, "delivery")) {
    const body = buildDeliveryMessage(order, balance, commissionAmount);
    const sent = await sendDriverWaMessage(driver.phone, body, "commission_on_delivery");
    await logCommissionNotification(sb, {
      order_id: order.id,
      driver_id: driver.driver_record_id,
      phone: normalizePhone(driver.phone) || normalizeDigits(driver.phone),
      channel: CHANNEL,
      status: sent ? "sent" : "failed",
      error: sent ? "kind:delivery" : "kind:delivery;wa_failed",
      sent_at: sent ? new Date().toISOString() : null,
      attempts: 1,
    });
    results.push({ kind: "delivery", sent, balance });
  } else {
    results.push({ kind: "delivery", sent: false, throttled: true });
  }

  if (balance > COMMISSION_ALERT_THRESHOLD && !shouldThrottle(driver.user_id, "threshold")) {
    const tBody = buildThresholdMessage(balance);
    const tSent = await sendDriverWaMessage(driver.phone, tBody, "commission_threshold");
    await logCommissionNotification(sb, {
      order_id: order.id,
      driver_id: driver.driver_record_id,
      phone: normalizePhone(driver.phone) || normalizeDigits(driver.phone),
      channel: CHANNEL,
      status: tSent ? "sent" : "failed",
      error: tSent ? "kind:threshold" : "kind:threshold;wa_failed",
      sent_at: tSent ? new Date().toISOString() : null,
      attempts: 1,
    });
    results.push({ kind: "threshold", sent: tSent, balance });
  }

  return { ok: true, balance, threshold: COMMISSION_ALERT_THRESHOLD, results };
}

function buildReminderMessage(balance, driverName) {
  const bal = Number(balance).toFixed(2);
  const who = driverName ? ` ${driverName}` : "";
  return (
    `📋 ERVENOW — تذكير تحصيل عمولة\n\n` +
    `مرحباً${who},\n` +
    `لديك مستحق عمولة COD بمبلغ ${bal} ر.س.\n\n` +
    `يرجى التواصل مع الإدارة لتسليم المبلغ في أقرب وقت.\n` +
    `شكراً لتعاونك.`
  );
}

async function resolveDriverByUserId(sb, driverUserId) {
  const userId = String(driverUserId || "").trim();
  if (!userId) return null;
  const { data: user } = await sb.from("users").select("id, phone").eq("id", userId).maybeSingle();
  const phoneDigits = normalizeDigits(user?.phone);
  if (!phoneDigits) return { user_id: userId, phone: null, driver_record_id: null, name: null };
  const { data: drivers } = await sb
    .from("drivers")
    .select("id, name, phone")
    .eq("phone", phoneDigits)
    .limit(3);
  let drv = (drivers || []).find((d) => normalizeDigits(d.phone) === phoneDigits);
  if (!drv && drivers?.length) drv = drivers[0];
  return {
    user_id: userId,
    phone: drv?.phone || user?.phone || phoneDigits,
    driver_record_id: drv?.id || null,
    name: drv?.name || null,
  };
}

/**
 * تذكير يدوي من لوحة الإدارة (واتساب).
 */
async function sendSmartCollectionReminder(sb, driverUserId) {
  const driver = await resolveDriverByUserId(sb, driverUserId);
  if (!driver?.phone) return { ok: false, reason: "no_phone" };
  const balance = await getDriverCommissionBalance(sb, driver.user_id);
  if (balance <= 0) return { ok: false, reason: "no_balance", balance: 0 };
  const body = buildReminderMessage(balance, driver.name);
  const sent = await sendDriverWaMessage(driver.phone, body, "commission_reminder");
  await logCommissionNotification(sb, {
    order_id: null,
    driver_id: driver.driver_record_id,
    phone: normalizePhone(driver.phone) || normalizeDigits(driver.phone),
    channel: CHANNEL,
    status: sent ? "sent" : "failed",
    error: sent ? "kind:reminder" : "kind:reminder;wa_failed",
    sent_at: sent ? new Date().toISOString() : null,
    attempts: 1,
  });
  return { ok: sent, sent, balance, driver_id: driver.user_id };
}

module.exports = {
  COMMISSION_ALERT_THRESHOLD,
  CHANNEL,
  notifySmartCollectionOnDelivered,
  sendSmartCollectionReminder,
};
