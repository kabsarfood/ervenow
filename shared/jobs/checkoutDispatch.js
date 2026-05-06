const { notifyNearestDrivers } = require("../../apps/driver/notify");
const { pushToErvenow } = require("../utils/ervenowPush");
const { perfLog } = require("../utils/perfLog");
const { logger } = require("../utils/logger");

/**
 * ما كان يُنفَّذ في مسار checkout بعد إنشاء الطلب: إشعار المناديب + دفع Ervenow + تحديث data.
 * يُستدعى من Worker فقط (أو inline عند عدم Redis).
 */
async function runCheckoutDispatch(sb, ctx) {
  const t0 = Date.now();
  const orderId = String(ctx.orderId || "").trim();
  if (!orderId || !sb) return;

  const { data: order, error: loadErr } = await sb.from("orders").select("*").eq("id", orderId).single();
  if (loadErr || !order) {
    perfLog("checkout-dispatch", { orderId, routeTime: Date.now() - t0, osrmStatus: "no_order" });
    return;
  }

  const dsGate = String(order.delivery_status || "").toLowerCase();
  if (dsGate === "draft") {
    perfLog("checkout-dispatch", { orderId, routeTime: Date.now() - t0, osrmStatus: "draft_skip" });
    return;
  }

  let osrmStatus = "ok";
  try {
    await notifyNearestDrivers(sb, order);
  } catch (notifyErr) {
    logger.error(
      { err: notifyErr && (notifyErr.message || String(notifyErr)), orderId },
      "[checkoutDispatch] notifyNearestDrivers"
    );
    osrmStatus = "notify_err";
  }

  const groupItems = Array.isArray(ctx.groupItems) ? ctx.groupItems : [];
  const total = Number(ctx.total) || 0;
  const orderData = order.data && typeof order.data === "object" ? order.data : {};

  if (orderData.pushed_to_delivery) {
    perfLog("checkout-dispatch", { orderId, routeTime: Date.now() - t0, osrmStatus: `${osrmStatus}_already_pushed` });
    return;
  }

  const firstItem = groupItems[0] || {};
  const firstData = firstItem && typeof firstItem.data === "object" && firstItem.data ? firstItem.data : {};
  const itemsText = groupItems.map((it) => String((it && it.title) || "طلب توصيل")).join(" | ");
  const customerPhone =
    order.customer_phone ||
    String(ctx.appUserPhone || "").trim() ||
    String(firstData.customer_phone || "").trim();

  try {
    await pushToErvenow({
      id: order.id,
      orderNumber: order.order_number,
      customerPhone,
      address: String(firstData.to || firstData.drop_address || firstData.location || "").trim(),
      lat: firstData.drop_lat,
      lng: firstData.drop_lng,
      items: groupItems,
      itemsText,
      total,
    });
    await sb
      .from("orders")
      .update({
        data: {
          ...orderData,
          pushed_to_delivery: true,
          pushed_to_delivery_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
  } catch (e) {
    logger.error({ err: e && (e.message || String(e)), orderId }, "[checkoutDispatch] PUSH ERROR");
    try {
      await sb.from("ervenow_push_queue").insert({
        payload: {
          id: order.id,
          orderNumber: order.order_number,
          customerPhone,
          address: String(firstData.to || firstData.drop_address || firstData.location || "").trim(),
          items: groupItems,
          total,
        },
        target_url: "delivery",
        status: "pending",
      });
    } catch (qErr) {
      logger.error({ err: qErr && (qErr.message || String(qErr)), orderId }, "[checkoutDispatch] PUSH QUEUE ERROR");
    }
    osrmStatus = `${osrmStatus}_push_fail`;
  }

  perfLog("checkout-dispatch", {
    orderId,
    routeTime: Date.now() - t0,
    osrmStatus,
  });
}

module.exports = { runCheckoutDispatch };
