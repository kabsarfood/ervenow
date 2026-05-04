const twilio = require("twilio");
const { toE164, normalizePhone } = require("../../shared/utils/phone");
const { sendNewOrderToDriver } = require("../../shared/services/whatsappService");

const seen = new Map();
const TTL_MS = 60 * 1000;
const sentCache = new Set();

const client = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

function waFrom() {
  const raw = String(process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
  if (!raw) return null;
  return raw.startsWith("whatsapp:") ? raw : "whatsapp:" + raw;
}

function keyFor(driver, order) {
  const did = String(driver?.id || "");
  const oid = String(order?.id || "");
  return did + ":" + oid;
}

function notifyDriver(driver, order) {
  const k = keyFor(driver, order);
  if (!k || k === ":") return;
  const now = Date.now();
  const last = Number(seen.get(k) || 0);
  if (now - last < TTL_MS) return;
  seen.set(k, now);
  console.log("🔔 NEW ORDER FOR DRIVER:", String(driver?.id || ""), "order:", String(order?.id || ""));
}

async function sendWhatsApp(to, body) {
  const e164 = toE164(String(to || ""));
  if (!e164) {
    console.log("WA SKIP INVALID PHONE:", to);
    return null;
  }
  const from = waFrom();
  if (!client || !from) {
    console.log("WA DEV:", e164, body);
    return null;
  }
  return client.messages.create({
    from,
    to: "whatsapp:" + e164,
    body: String(body || ""),
  });
}

function roughKmToPickup(driver, order) {
  const orderLat = Number(order?.pickup_lat);
  const orderLng = Number(order?.pickup_lng);
  const dLat = Number(driver.lat);
  const dLng = Number(driver.lng);
  if (!Number.isFinite(orderLat) || !Number.isFinite(orderLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
    return Infinity;
  }
  const r = roughDistanceKm(dLat, dLng, orderLat, orderLng);
  return Number.isFinite(r) ? r : Infinity;
}

async function getNearestDrivers(sb, order) {
  const orderLat = Number(order?.pickup_lat);
  const orderLng = Number(order?.pickup_lng);
  if (!Number.isFinite(orderLat) || !Number.isFinite(orderLng)) return [];

  const { data: drivers, error } = await sb
    .from("drivers")
    .select("*")
    .eq("status", "approved")
    .eq("active", true)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error || !drivers?.length) return [];

  const ROUGH_TOP_N = 30;
  const OSRM_TOP_N = 10;

  const roughSorted = [...drivers].sort((a, b) => roughKmToPickup(a, order) - roughKmToPickup(b, order));
  const top30 = roughSorted.slice(0, ROUGH_TOP_N);
  const top10 = top30.slice(0, OSRM_TOP_N);

  const refined = await Promise.all(
    top10.map(async (d) => {
      const dLat = Number(d.lat);
      const dLng = Number(d.lng);
      const km = await routeKmWithRoughFallback(dLat, dLng, orderLat, orderLng);
      const dist = Number.isFinite(km) ? km : Infinity;
      return { ...d, dist };
    })
  );

  refined.sort((a, b) => a.dist - b.dist);
  return refined.slice(0, 3);
}

function canNotify(orderId, driverId) {
  const key = String(orderId) + "_" + String(driverId);
  if (sentCache.has(key)) return false;
  sentCache.add(key);
  setTimeout(() => sentCache.delete(key), 60_000);
  return true;
}

async function notifyNearestDrivers(sb, order) {
  const drivers = await getNearestDrivers(sb, order);
  if (!drivers.length) return { notified: 0 };

  let sent = 0;
  for (const d of drivers) {
    if (!canNotify(order?.id, d?.id)) continue;
    let row = null;
    try {
      const ins = await sb
        .from("driver_notifications")
        .insert({
          order_id: order.id,
          driver_id: d.id,
          phone: normalizePhone(d.phone) || String(d.phone || "").replace(/\D/g, ""),
          status: "pending",
        })
        .select()
        .single();
      row = ins && ins.data ? ins.data : null;
    } catch (logErr) {
      console.error("NOTIFY LOG INSERT ERROR:", logErr && (logErr.message || logErr));
    }
    try {
      const sentOk = await sendNewOrderToDriver(d, order);
      if (sentOk && row && row.id) {
        await sb
          .from("driver_notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: Number(row.attempts || 0) + 1,
            error: null,
          })
          .eq("id", row.id);
        sent += 1;
      } else if (row && row.id) {
        await sb
          .from("driver_notifications")
          .update({
            status: "failed",
            error: sentOk ? "unknown" : "WA send skipped or failed",
            attempts: Number(row.attempts || 0) + 1,
          })
          .eq("id", row.id);
      }
    } catch (e) {
      if (row && row.id) {
        try {
          await sb
            .from("driver_notifications")
            .update({
              status: "failed",
              error: String(e && (e.message || e) || "WA send failed"),
              attempts: Number(row.attempts || 0) + 1,
            })
            .eq("id", row.id);
        } catch (upErr) {
          console.error("NOTIFY LOG UPDATE ERROR:", upErr && (upErr.message || upErr));
        }
      }
      console.error("WA ERROR:", e && (e.message || e));
    }
  }
  return { notified: sent };
}

module.exports = { notifyDriver, notifyNearestDrivers, getNearestDrivers, sendWhatsApp };
