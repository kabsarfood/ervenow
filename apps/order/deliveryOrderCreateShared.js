/**
 * ERVENOW — مصدر حقيقة واحد لإنشاء طلب توصيل فقط (بدون عناصر سلة).
 * يستخدمه:
 *   POST /api/order/create  (فرع التوصيل)
 *   POST /api/delivery/orders (proxy داخلي — نفس المنطق)
 *
 * لا يغيّر شكل الاستجابة للواجهات؛ يقلّل تفرّع المنطق بين المسارين.
 */
const { normalizeIdempotencyKey, isOrdersIdempotencyColumnMissingError } = require("../../shared/utils/idempotency");
const { logger } = require("../../shared/utils/logger");
const { isOrderPaymentGateRequired } = require("../../shared/utils/orderPaymentGate");
const { createDeliveryOrderFromBody, isPaidFromRequestBody } = require("../delivery/service");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { createNotification } = require("../../shared/services/notificationService");

/**
 * @typedef {"delivery"|"order"} DeliveryEntryPoint
 * - delivery: يطبّق منطق series_source من ترويسة X-Source والافتراضي ervenow (كما كان POST /api/delivery/orders).
 * - order: لا يفرض series_source الافتراضي إن غاب (كما كان POST /api/order/create).
 */

/**
 * @param {object} params
 * @param {import("@supabase/supabase-js").SupabaseClient} params.sb
 * @param {object} params.appUser
 * @param {object} params.body
 * @param {string|null|undefined} params.idempotencyKey
 * @param {string|null|undefined} params.xSourceHeader
 * @param {DeliveryEntryPoint} params.entryPoint
 * @returns {Promise<
 *   | { ok: true; order: object; duplicated: boolean; idempotentReplay: boolean; paid: boolean; delivery_status: string|null }
 *   | { ok: false; status: number; message: string }
 * >}
 */
async function runUnifiedDeliveryOnlyCreate({ sb, appUser, body, idempotencyKey, xSourceHeader, entryPoint }) {
  const raw = body && typeof body === "object" ? body : {};
  const cleanBody = { ...raw };
  delete cleanBody.idempotency_key;

  const idemKey = idempotencyKey != null && String(idempotencyKey).trim() !== "" ? String(idempotencyKey).trim() : null;
  if (idemKey) {
    const { data: existing, error: idemErr } = await sb
      .from("orders")
      .select("*")
      .eq("customer_id", appUser.id)
      .eq("idempotency_key", idemKey)
      .maybeSingle();
    if (idemErr) {
      if (!isOrdersIdempotencyColumnMissingError(idemErr)) {
        return { ok: false, status: 400, message: idemErr.message };
      }
      logger.warn(
        { err: idemErr.message },
        "[deliveryOrderCreateShared] orders.idempotency_key missing — run shared/migration_orders_idempotency_key.sql; continuing without idempotency lookup"
      );
    } else if (existing) {
      return {
        ok: true,
        order: existing,
        duplicated: false,
        idempotentReplay: true,
        paid: false,
        delivery_status: existing?.delivery_status != null ? String(existing.delivery_status) : null,
      };
    } else {
      cleanBody.idempotency_key = idemKey;
    }
  }

  if (entryPoint === "delivery") {
    const src = xSourceHeader != null ? String(xSourceHeader).trim() : "";
    if ((cleanBody.series_source == null || String(cleanBody.series_source).trim() === "") && src) {
      cleanBody.series_source = src;
    }
    if (cleanBody.series_source == null || String(cleanBody.series_source).trim() === "") {
      cleanBody.series_source = "ervenow";
    }
  }

  const extRaw = cleanBody.external_order_id;
  if (extRaw != null && String(extRaw).trim() !== "") {
    const ext = String(extRaw).trim();
    const { data: existing, error: exErr } = await sb.from("orders").select("*").eq("external_order_id", ext).maybeSingle();
    if (exErr) return { ok: false, status: 400, message: exErr.message };
    if (existing) {
      return {
        ok: true,
        order: existing,
        duplicated: true,
        idempotentReplay: false,
        paid: false,
        delivery_status: existing?.delivery_status != null ? String(existing.delivery_status) : null,
      };
    }
  }

  const gateEnv = isOrderPaymentGateRequired();
  /* المرحلة 1 (توافق خلفي): POST /api/delivery/orders كان يتجاهل بوابة الدفع ويُنشئ pending دائماً.
   * استخدم POST /api/order/create لاحترام ERVENOW_REQUIRE_ORDER_PAYMENT=1 على إنشاء جديد. */
  const usePaymentGate = entryPoint === "delivery" ? false : gateEnv;
  const paymentConfirmed = usePaymentGate ? isPaidFromRequestBody(cleanBody) : false;
  const initialDeliveryStatus = usePaymentGate ? (paymentConfirmed ? "pending" : "draft") : "pending";
  const payment_status = paymentConfirmed ? "paid" : "pending";

  const { data, error } = await createDeliveryOrderFromBody(sb, appUser, cleanBody, {
    initialDeliveryStatus,
    payment_status,
  });
  if (error) return { ok: false, status: 400, message: error.message };

  if (data && initialDeliveryStatus === "pending") {
    try {
      await enqueueDeliveryJob("new-order", {
        orderId: data.id,
        pickup:
          data.pickup_lat != null && data.pickup_lng != null
            ? { lat: Number(data.pickup_lat), lng: Number(data.pickup_lng) }
            : null,
        dropoff:
          data.drop_lat != null && data.drop_lng != null ? { lat: Number(data.drop_lat), lng: Number(data.drop_lng) } : null,
      });
    } catch (qe) {
      logger.error({ err: qe && (qe.message || String(qe)), orderId: data.id }, "[deliveryOrderCreateShared] enqueue new-order");
    }
    await bumpDeliveryOrdersListEpoch();
  } else if (data) {
    await bumpDeliveryOrdersListEpoch();
  }

  if (data && appUser && appUser.id) {
    try {
      await createNotification(sb, {
        recipient_type: "customer",
        recipient_id: appUser.id,
        title: "تم استلام طلبك",
        message: "تم إنشاء الطلب بنجاح وهو الآن قيد المعالجة.",
        type: "order",
        source: "delivery",
        payload: {
          order_id: data.id,
          order_number: data.order_number || null,
          delivery_status: data.delivery_status || null,
        },
      });
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr.message || String(notifyErr), orderId: data.id },
        "[deliveryOrderCreateShared] customer create notification"
      );
    }
  }

  return {
    ok: true,
    order: data,
    duplicated: false,
    idempotentReplay: false,
    paid: paymentConfirmed,
    delivery_status: data?.delivery_status != null ? String(data.delivery_status) : null,
  };
}

/**
 * لاستخدامه من Express مع طلب يحمل Idempotency-Key في الترويسة أو الجسم.
 * @param {import("express").Request} req
 */
function readIdempotencyKey(req) {
  return normalizeIdempotencyKey(req);
}

module.exports = {
  runUnifiedDeliveryOnlyCreate,
  readIdempotencyKey,
};
