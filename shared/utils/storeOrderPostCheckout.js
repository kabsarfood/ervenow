const { createServiceClient } = require("../config/supabase");
const { logger } = require("./logger");
const { shadowLedgerSettleDeliveredOrder } = require("../services/shadowLedger");

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
 * بعد إنشاء طلب متجر: إيداع صافي المبيعات في محفظة المتجر + إشعار واتساب لجوال المتجر.
 * لا يرمي للأعلى — أخطاء التسجيل فقط في السجلات حتى لا يُلغى نجاح checkout.
 */
async function runStoreCheckoutSideEffects({ order, groupItems, storeRow }) {
  if (!order || !order.store_id) return;
  const svc = createServiceClient();
  if (!svc) {
    logger.warn("[storePostCheckout] no service client");
    return;
  }

  const orderTotal = Number(order.order_total || 0);
  const { PLATFORM_COMMISSION_RATE } = require("./platformCommission");
  const commissionRate = PLATFORM_COMMISSION_RATE;
  const goodsPlatformFee = Math.round(orderTotal * commissionRate * 100) / 100;
  const net = Math.round((orderTotal - goodsPlatformFee) * 100) / 100;
  const pay = String(order.payment_status || "").trim().toLowerCase();
  if (pay === "paid" && net > 0) {
    const { error: rpcErr } = await svc.rpc("store_wallet_credit_for_order", {
      p_store_id: order.store_id,
      p_order_id: order.id,
      p_amount: net,
      p_description: `طلب ${order.order_number || order.id}`,
    });
    if (rpcErr) {
      const msg = String(rpcErr.message || rpcErr.details || rpcErr);
      if (!/store_wallets|store_transactions|function.*does not exist|schema cache/i.test(msg)) {
        logger.error({ err: msg, orderId: order.id }, "[storePostCheckout] wallet credit");
      } else {
        logger.warn({ err: msg, orderId: order.id }, "[storePostCheckout] wallet tables missing — run migration_store_wallet.sql");
      }
    }
  } else if (net > 0) {
    logger.info(
      { orderId: order.id, payment_status: order.payment_status },
      "[storePostCheckout] skip wallet until payment_status=paid"
    );
  }

  void shadowLedgerSettleDeliveredOrder(svc, order.id, { context: "store:checkout" });

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
