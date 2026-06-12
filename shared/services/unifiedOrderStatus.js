/**
 * PATCH موحّد لحالة الطلب — delivery_status فقط.
 * SoT: PATCH /api/order/:id/status
 */

const { isValidDeliveryTransition } = require("../utils/helpers");
const { getOrderDeliveryStatus, normalizeIncomingStatus, buildOrderStatusPatch, isTerminalOrderStatus } = require("../domain/orders/orderStatus");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { runDeliveredFinancialSettlement } = require("./deliveredFinancialSettlement");
const { completeServiceOrder, isServiceOrderRow } = require("./completeServiceOrder");
const { getOrderProviderId } = require("../utils/orderProviderId");
const { updateOrdersResilient } = require("../utils/idempotency");
const { logger } = require("../utils/logger");
const { broadcastOrderPatch, broadcastStoreOrderEvent, orderPatchFromRow } = require("../lib/trackingSocket");
const { bumpDeliveryOrdersListEpoch } = require("../utils/deliveryOrdersListCache");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { createNotification } = require("./notificationService");
const { notifyProvidersForBooking } = require("./serviceBookingNotify");
const { isDriverDispatchOrder, isInternalDeliveryOrder } = require("../utils/driverDispatchOrders");
const { notifyInternalDeliveryOrder } = require("./internalDeliveryNotify");
const { normalizePhone } = require("../utils/phone");

const MERCHANT_WORKFLOW_STATUSES = [
  DELIVERY_STATUS.ACCEPTED,
  DELIVERY_STATUS.PREPARING,
  DELIVERY_STATUS.READY,
];

const STORE_ORDER_TYPES = new Set(["store", "restaurant"]);

async function enqueueJobForPublishedOrder(order) {
  if (!order?.id) return;
  await enqueueDeliveryJob("new-order", { orderId: order.id });
}

function canPatchOrderStatus(order, appUser, nextStatus) {
  const u = appUser;
  const next = normalizeIncomingStatus(nextStatus);
  if (!u?.role) return false;

  if (u.role === "admin") return true;

  if (u.role === "customer" && order.customer_id === u.id) {
    return next === DELIVERY_STATUS.CANCELLED || next === DELIVERY_STATUS.CANCELLED_BY_CUSTOMER;
  }

  if (u.role === "driver" && order.driver_id === u.id) {
    return [
      DELIVERY_STATUS.ACCEPTED,
      DELIVERY_STATUS.PICKED,
      DELIVERY_STATUS.PICKED_UP,
      DELIVERY_STATUS.DELIVERING,
      DELIVERY_STATUS.DELIVERED,
    ].includes(next);
  }

  if (u.role === "driver" && !order.driver_id) {
    const open = [DELIVERY_STATUS.NEW, DELIVERY_STATUS.PENDING, DELIVERY_STATUS.READY].includes(
      getOrderDeliveryStatus(order)
    );
    if (open && next === DELIVERY_STATUS.ACCEPTED) return true;
    if (open && next === DELIVERY_STATUS.PICKED_UP) return true;
  }

  if (u.role === "service" && getOrderProviderId(order) === u.id) {
    return [DELIVERY_STATUS.DELIVERING, DELIVERY_STATUS.DELIVERED].includes(next);
  }

  return false;
}

async function merchantOwnsOrder(sb, order, appUser) {
  if (!order || !appUser?.id) return false;
  if (order.merchant_id && String(order.merchant_id) === String(appUser.id)) return true;
  if (!order.store_id || !sb) return false;
  const digits = normalizePhone(appUser.phone);
  if (!digits) return false;
  const { data: st } = await sb.from("stores").select("id, phone").eq("id", order.store_id).maybeSingle();
  if (!st?.phone) return false;
  return normalizePhone(st.phone) === digits;
}

async function canUserPatchOrderStatus(sb, order, appUser, nextStatus) {
  const next = normalizeIncomingStatus(nextStatus);
  if (!next) return false;

  if (canPatchOrderStatus(order, appUser, next)) return true;

  if (!["store", "merchant", "restaurant"].includes(appUser?.role)) return false;
  if (!MERCHANT_WORKFLOW_STATUSES.includes(next)) return false;

  const current = getOrderDeliveryStatus(order);
  if (!isValidDeliveryTransition(current, next)) return false;

  const ot = String(order.order_type || "").toLowerCase();
  if (!STORE_ORDER_TYPES.has(ot) && !order.store_id) return false;

  return merchantOwnsOrder(sb, order, appUser);
}

async function afterStatusSideEffects(sb, order, previousStatus, nextStatus, financialResult) {
  const ds = normalizeIncomingStatus(nextStatus);
  const prevDs = normalizeIncomingStatus(previousStatus);
  const settlementRow = financialResult && financialResult.settlement ? financialResult.settlement : financialResult || {};

  if (prevDs === DELIVERY_STATUS.DRAFT && ds === DELIVERY_STATUS.PENDING) {
    const ot = String(order.order_type || "").toLowerCase();
    if (isInternalDeliveryOrder(order)) {
      try {
        await enqueueJobForPublishedOrder(order);
        await notifyInternalDeliveryOrder(sb, order);
      } catch (notifyErr) {
        logger.error(
          { err: notifyErr.message || String(notifyErr), orderId: order.id },
          "[unifiedOrderStatus] internal_delivery draft→pending"
        );
      }
    } else if (ot === "service" || ot === "gas_delivery") {
      try {
        await notifyProvidersForBooking(sb, order);
      } catch (notifyErr) {
        logger.error(
          { err: notifyErr.message || String(notifyErr), orderId: order.id },
          "[unifiedOrderStatus] notify providers draft→pending"
        );
      }
    } else if (isDriverDispatchOrder(order)) {
      try {
        await enqueueJobForPublishedOrder(order);
      } catch (qe) {
        logger.error({ err: qe.message || String(qe), orderId: order.id }, "[unifiedOrderStatus] enqueue draft→pending");
      }
    }
  }

  const merchantCustomerNotify = {
    [DELIVERY_STATUS.ACCEPTED]: { title: "تم قبول طلبك", message: "المتجر قبل طلبك." },
    [DELIVERY_STATUS.PREPARING]: { title: "جاري التجهيز", message: "يتم تجهيز طلبك الآن." },
    [DELIVERY_STATUS.READY]: { title: "طلبك جاهز", message: "طلبك جاهز للاستلام — سيتوجه المندوب قريباً." },
  };
  if (order.customer_id && merchantCustomerNotify[ds]) {
    try {
      const msg = merchantCustomerNotify[ds];
      await createNotification(sb, {
        recipient_type: "customer",
        recipient_id: order.customer_id,
        title: msg.title,
        message: msg.message,
        type: "delivery",
        source: "store_workflow",
        payload: {
          order_id: order.id,
          order_number: order.order_number || null,
          delivery_status: ds,
        },
      });
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr.message || String(notifyErr), orderId: order.id },
        "[unifiedOrderStatus] merchant workflow customer notification"
      );
    }
  }

  const driverCustomerNotify = {
    [DELIVERY_STATUS.PICKED_UP]: { title: "تم الاستلام من المتجر", message: "تم استلام الطلب من المتجر." },
    [DELIVERY_STATUS.DELIVERING]: { title: "المندوب في الطريق", message: "المندوب في الطريق إليك." },
    [DELIVERY_STATUS.DELIVERED]: { title: "تم التسليم", message: "تم تسليم الطلب." },
  };
  if (order.customer_id && driverCustomerNotify[ds]) {
    try {
      const msg = driverCustomerNotify[ds];
      await createNotification(sb, {
        recipient_type: "customer",
        recipient_id: order.customer_id,
        title: msg.title,
        message: msg.message,
        type: "delivery",
        source: "driver_workflow",
        payload: {
          order_id: order.id,
          order_number: order.order_number || null,
          delivery_status: ds,
        },
      });
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr.message || String(notifyErr), orderId: order.id },
        "[unifiedOrderStatus] driver workflow customer notification"
      );
    }
  }

  if (ds === DELIVERY_STATUS.READY && STORE_ORDER_TYPES.has(String(order.order_type || "").toLowerCase())) {
    try {
      const { notifyNearestDrivers } = require("../../apps/driver/notify");
      await notifyNearestDrivers(sb, order);
    } catch (driverNotifyErr) {
      logger.warn(
        { err: driverNotifyErr.message || String(driverNotifyErr), orderId: order.id },
        "[unifiedOrderStatus] notify drivers on ready"
      );
    }
  }

  if (ds === DELIVERY_STATUS.DELIVERED && order.driver_id) {
    try {
      const { notifySmartCollectionOnDelivered } = require("./smartCollectionNotify");
      notifySmartCollectionOnDelivered(sb, order, settlementRow || {}).catch((nErr) =>
        logger.warn({ err: nErr.message || String(nErr), orderId: order.id }, "[smart-collection]")
      );
    } catch (_e) {}
  }

  if (ds === DELIVERY_STATUS.DELIVERED) {
    const driverAmount =
      settlementRow && Number.isFinite(Number(settlementRow.driver)) ? Number(settlementRow.driver) : null;
    if (order.driver_id && driverAmount != null && driverAmount > 0) {
      try {
        await createNotification(sb, {
          recipient_type: "driver",
          recipient_id: order.driver_id,
          title: "تمت تسوية مالية",
          message: "تم تحديث الرصيد بعد تنفيذ التسوية المالية.",
          type: "payment",
          source: "wallet",
          payload: {
            amount: driverAmount,
            currency: "SAR",
            reference: order.id,
            wallet_id: settlementRow.driver_wallet_id || null,
            order_id: order.id,
          },
        });
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr.message || String(notifyErr), orderId: order.id },
          "[unifiedOrderStatus] driver settlement notification"
        );
      }
    }
  }

  if (ds === DELIVERY_STATUS.DELIVERED) {
    const providerCredit = financialResult && financialResult.provider_credit ? financialResult.provider_credit : null;
    const providerAmount = providerCredit && Number.isFinite(Number(providerCredit.amount))
      ? Number(providerCredit.amount)
      : null;
    const providerId = getOrderProviderId(order);
    if (
      providerId &&
      providerAmount != null &&
      providerAmount > 0 &&
      (providerCredit.ok === true || providerCredit.ok === "true" || providerCredit.reason === "duplicate")
    ) {
      try {
        await createNotification(sb, {
          recipient_type: "provider",
          recipient_id: providerId,
          title: "تمت تسوية مالية",
          message: "تم تحديث الرصيد بعد تنفيذ التسوية المالية.",
          type: "payment",
          source: "wallet",
          payload: {
            amount: providerAmount,
            currency: "SAR",
            reference: order.id,
            wallet_id: providerCredit.wallet_id || null,
            order_id: order.id,
          },
        });
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr.message || String(notifyErr), orderId: order.id },
          "[unifiedOrderStatus] provider settlement notification"
        );
      }
    }
  }

  if (order.id) {
    const patch = orderPatchFromRow(order);
    broadcastOrderPatch(String(order.id), patch);
    if (order.store_id) {
      broadcastStoreOrderEvent(String(order.store_id), {
        orderId: String(order.id),
        store_id: order.store_id,
        patch,
      });
    }
  }
  await bumpDeliveryOrdersListEpoch();
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} entityId — orders.id
 * @param {string} nextStatusRaw
 * @param {object} appUser
 */
async function patchUnifiedOrderStatus(sb, entityId, nextStatusRaw, appUser) {
  const id = String(entityId || "").trim();
  const nextStatus = normalizeIncomingStatus(nextStatusRaw);
  if (!id || !nextStatus) {
    return { data: null, error: new Error("status required") };
  }

  const { data: order, error: gErr } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (gErr) return { data: null, error: gErr };

  if (!order) {
    return { data: null, error: new Error("Not found") };
  }

  if (isServiceOrderRow(order) && (nextStatus === DELIVERY_STATUS.DELIVERING || nextStatus === DELIVERY_STATUS.DELIVERED)) {
    if (!(await canUserPatchOrderStatus(sb, order, appUser, nextStatus))) {
      return { data: null, error: new Error("Forbidden") };
    }
    let actor = "legacy";
    if (nextStatus === DELIVERY_STATUS.DELIVERING) actor = "provider";
    else if (nextStatus === DELIVERY_STATUS.DELIVERED) {
      actor =
        appUser.role === "customer" && order.customer_id === appUser.id
          ? "customer"
          : appUser.role === "service"
            ? "provider"
            : "both";
    }
    const svcOut = await completeServiceOrder(sb, id, getOrderProviderId(order) || appUser.id, {
      actor,
    });
    if (svcOut.error) return { data: null, error: svcOut.error };
    return { data: svcOut.data, error: null, entity: "order", order_type: order.order_type };
  }

  {
    const current = getOrderDeliveryStatus(order);
    if (isTerminalOrderStatus(current) && nextStatus !== current) {
      return { data: null, error: new Error(`Order already terminal: ${current}`) };
    }
    if (!(await canUserPatchOrderStatus(sb, order, appUser, nextStatus))) {
      return { data: null, error: new Error("Forbidden") };
    }
    if (!isValidDeliveryTransition(current, nextStatus)) {
      return { data: null, error: new Error(`Invalid transition ${current} → ${nextStatus}`) };
    }

    const patch = buildOrderStatusPatch(nextStatus);
    if (
      appUser.role === "driver" &&
      !order.driver_id &&
      [DELIVERY_STATUS.ACCEPTED, DELIVERY_STATUS.PICKED_UP, DELIVERY_STATUS.DELIVERED].includes(nextStatus)
    ) {
      patch.driver_id = appUser.id;
    }
    if (nextStatus === DELIVERY_STATUS.DELIVERED && appUser.role === "driver" && !order.driver_id) {
      patch.driver_id = appUser.id;
    }

    const { data, error } = await updateOrdersResilient(sb, patch, { id });
    if (error) return { data: null, error };

    let financial = { settlement: null, provider_credit: null };
    if (nextStatus === DELIVERY_STATUS.DELIVERED) {
      financial = await runDeliveredFinancialSettlement(sb, data, "unified:delivered");
      const settlementRow = financial.settlement;
      if (
        settlementRow &&
        settlementRow.ok !== true &&
        settlementRow.ok !== "true" &&
        settlementRow.reason !== "already_settled" &&
        !settlementRow.skipped
      ) {
        logger.warn({ orderId: id, result: settlementRow }, "[unifiedOrderStatus] ledger settlement");
      }
      const providerCreditRow = financial.provider_credit;
      if (
        providerCreditRow &&
        providerCreditRow.ok !== true &&
        providerCreditRow.ok !== "true" &&
        providerCreditRow.reason !== "duplicate" &&
        !providerCreditRow.skipped
      ) {
        logger.warn({ orderId: id, result: providerCreditRow }, "[unifiedOrderStatus] provider ledger credit");
      }
      const driverCreditRow = financial.driver_credit;
      if (
        driverCreditRow &&
        driverCreditRow.ok !== true &&
        driverCreditRow.ok !== "true" &&
        driverCreditRow.reason !== "settled_via_rpc" &&
        !driverCreditRow.skipped
      ) {
        logger.warn({ orderId: id, result: driverCreditRow }, "[unifiedOrderStatus] driver ledger credit");
      }
    }

    await afterStatusSideEffects(sb, data, current, nextStatus, financial);
    return {
      data,
      error: null,
      entity: "order",
      settlement: financial.settlement,
      provider_credit: financial.provider_credit,
      driver_credit: financial.driver_credit,
    };
  }
}

module.exports = {
  patchUnifiedOrderStatus,
  canPatchOrderStatus,
  canUserPatchOrderStatus,
  merchantOwnsOrder,
  afterStatusSideEffects,
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
};
