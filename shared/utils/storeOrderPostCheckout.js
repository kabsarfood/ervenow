const { createServiceClient } = require("../config/supabase");
const { logger } = require("./logger");

let twilioFactory = null;
try {
  twilioFactory = require("twilio");
} catch {
  twilioFactory = null;
}

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !twilioFactory) return null;
  return twilioFactory(sid, token);
}

function waFrom() {
  let n = String(process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
  if (!n) return null;
  if (!n.startsWith("whatsapp:")) n = "whatsapp:" + n.replace(/^\+/, "+");
  return n;
}

function buildItemsSnippet(groupItems, max) {
  const m = Number(max) > 0 ? Number(max) : 4;
  const titles = (groupItems || []).map((i) => String(i.title || "").trim()).filter(Boolean);
  const s = titles.slice(0, m).join("، ");
  return titles.length > m ? `${s} …` : s;
}

/**
 * بعد إنشاء طلب متجر: إشعار واتساب فقط.
 * إيداع صافي التاجر يتم عند التسليم عبر deliveredFinancialSettlement (مرجع واحد).
 */
async function runStoreCheckoutSideEffects({ order, groupItems, storeRow }) {
  if (!order || !order.store_id) return;
  const svc = createServiceClient();
  if (!svc) {
    logger.warn("[storePostCheckout] no service client");
    return;
  }

  const phoneDigits = String(storeRow?.phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 9) return;

  const client = getTwilioClient();
  const from = waFrom();
  if (!client || !from) {
    logger.warn("[storePostCheckout] WhatsApp: Twilio غير مضبوط");
    return;
  }

  const to = "whatsapp:+" + phoneDigits;
  const snippet = buildItemsSnippet(groupItems, 5);
  const cust = String(order.customer_phone || "").trim();
  const body =
    `🛒 طلب جديد — ERVENOW\n` +
    `المتجر: ${String(storeRow?.name || "").trim() || "—"}\n` +
    `رقم الطلب: ${order.order_number || order.id}\n` +
    `العميل: ${cust || "—"}\n` +
    `المنتجات: ${snippet || "—"}\n` +
    `إجمالي السلة: ${Number(order.order_total || 0).toFixed(2)} ريال\n` +
    `الإجمالي مع التوصيل والضريبة: ${Number(order.total_with_vat ?? order.total_amount ?? 0).toFixed(2)} ريال`;

  try {
    await client.messages.create({ from, to, body });
  } catch (e) {
    logger.error({ err: e && (e.message || String(e)), orderId: order.id }, "[storePostCheckout] WhatsApp send");
  }
}

module.exports = { runStoreCheckoutSideEffects, buildItemsSnippet };
