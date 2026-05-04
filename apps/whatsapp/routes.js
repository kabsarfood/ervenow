/**
 * واتساب — Webhook استقبال (Twilio) + قائمة تفاعل بسيطة
 */

const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { normalizePhone } = require("../../shared/utils/phone");
const { acceptOrder } = require("../delivery/service");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const {
  sendOrderAcceptedToCustomer,
  buildSupportMenuBody,
} = require("../../shared/services/whatsappService");
const { buildPublicTrackUrl } = require("../../shared/messages/deliveryCustomerWhatsApp");

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const SPAM_WINDOW_MS = 60_000;
const SPAM_MAX = 25;
const spamBuckets = new Map();

function allowInbound(phoneDigits) {
  const k = String(phoneDigits || "");
  if (!k) return false;
  const now = Date.now();
  let b = spamBuckets.get(k);
  if (!b || now - b.start > SPAM_WINDOW_MS) {
    b = { start: now, n: 0 };
    spamBuckets.set(k, b);
  }
  b.n += 1;
  return b.n <= SPAM_MAX;
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function twimlMessage(text) {
  const body = escapeXml(text);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${body}</Message></Response>`;
}

/** مطابقة رقم Twilio مع عمود users.phone (تخزين 966…) */
async function findUserByWhatsAppFrom(sb, fromRaw) {
  const raw = String(fromRaw || "").replace(/^whatsapp:/i, "").trim();
  const digits = normalizePhone(raw);
  if (!digits) return null;
  const { data, error } = await sb.from("users").select("id, role, phone").eq("phone", digits).maybeSingle();
  if (error || !data) return null;
  return { ...data, _digits: digits };
}

router.get("/webhook", (_req, res) => {
  res.type("text/plain").send("ERVENOW WhatsApp webhook OK");
});

router.post("/webhook", async (req, res) => {
  const fromRaw = req.body.From || "";
  const bodyRaw = String(req.body.Body || "").trim();
  const choice = bodyRaw.replace(/\s/g, "").charAt(0);

  const sb = createServiceClient();
  if (!sb) {
    res.type("text/xml").send(twimlMessage("الخدمة غير متاحة مؤقتاً."));
    return;
  }

  const digits = normalizePhone(fromRaw.replace(/^whatsapp:/i, ""));
  if (!digits || !allowInbound(digits)) {
    res.type("text/xml").send(twimlMessage("تم تجاوز حد الرسائل، حاول لاحقاً."));
    return;
  }

  const user = await findUserByWhatsAppFrom(sb, fromRaw);
  const role = String(user?.role || "").toLowerCase();

  try {
    if (choice === "1") {
      if (!user || role !== "driver") {
        res.type("text/xml").send(twimlMessage("هذا الرقم غير مسجّل كمندوب في ERVENOW."));
        return;
      }
      const { data: notifs } = await sb
        .from("driver_notifications")
        .select("order_id, created_at")
        .eq("phone", digits)
        .order("created_at", { ascending: false })
        .limit(8);
      let accepted = null;
      for (const n of notifs || []) {
        if (!n?.order_id) continue;
        const { data, error } = await acceptOrder(sb, String(n.order_id), user.id);
        if (!error && data) {
          accepted = data;
          break;
        }
      }
      if (accepted) {
        await bumpDeliveryOrdersListEpoch();
        const driverLine = user.phone || digits;
        await sendOrderAcceptedToCustomer(accepted, driverLine);
        res.type("text/xml").send(twimlMessage("تم قبول الطلب من حسابك. تم إشعار العميل."));
        return;
      }
      res
        .type("text/xml")
        .send(twimlMessage("لا يوجد طلب متاح للقبول حالياً. افتح رابط الطلب في الرسالة السابقة أو تطبيق المندوب."));
      return;
    }

    if (choice === "2") {
      res
        .type("text/xml")
        .send(
          twimlMessage(
            "رفض الطلب من واتساب قيد التطوير. استخدم تطبيق المندوب أو تجاهل الطلب إن لم يعد مطلوباً."
          )
        );
      return;
    }

    if (choice === "3") {
      const { data: notif } = await sb
        .from("driver_notifications")
        .select("order_id")
        .eq("phone", digits)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!notif?.order_id) {
        res.type("text/xml").send(twimlMessage("لا توجد تفاصيل طلب حديثة لهذا الرقم."));
        return;
      }
      const { data: ord, error: oErr } = await sb.from("orders").select("*").eq("id", notif.order_id).maybeSingle();
      if (oErr || !ord) {
        res.type("text/xml").send(twimlMessage("تعذّر جلب الطلب."));
        return;
      }
      const label = ord.order_number || ord.id;
      const fee = Number(ord.delivery_fee) || Number(ord.driver_earning) || 0;
      const track = buildPublicTrackUrl(ord.id) || "—";
      const lines = [
        `تفاصيل الطلب ${label}`,
        `الحالة: ${ord.delivery_status || ord.status || "—"}`,
        `من: ${String(ord.pickup_address || "—").slice(0, 120)}`,
        `إلى: ${String(ord.drop_address || "—").slice(0, 120)}`,
        `التوصيل: ${fee} ر.س`,
        `التتبع: ${track}`,
      ];
      res.type("text/xml").send(twimlMessage(lines.join("\n")));
      return;
    }

    res.type("text/xml").send(twimlMessage(buildSupportMenuBody()));
  } catch (e) {
    console.error("[whatsapp/webhook]", e && (e.message || e));
    res.type("text/xml").send(twimlMessage("حدث خطأ. حاول لاحقاً."));
  }
});

module.exports = router;
