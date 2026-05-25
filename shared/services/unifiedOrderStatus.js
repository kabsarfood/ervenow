/**
 * PATCH موحّد لحالة الطلب — delivery_status فقط.
 * SoT: PATCH /api/order/:id/status
 */

const { isValidDeliveryTransition } = require("../utils/helpers");
const { getOrderDeliveryStatus, normalizeIncomingStatus, buildOrderStatusPatch, isTerminalOrderStatus } = require("../domain/orders/orderStatus");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { settleDeliveredOrderLedgerOnly } = require("./ledgerOnlySettlement");
const { completeServiceOrder, isServiceOrderRow } = require("./completeServiceOrder");
const { logger } = require("../utils/logger");
const { broadcastOrderPatch, orderPatchFromRow } = require("../lib/trackingSocket");
const { bumpDeliveryOrdersListEpoch } = require("../utils/deliveryOrdersListCache");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");

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
      DELIVERY_STATUS.DELIVERING,
      DELIVERY_STATUS.DELIVERED,
    ].includes(next);
  }

  if (["merchant", "restaurant"].includes(u.role) && order.merchant_id === u.id) {
    return next === DELIVERY_STATUS.ACCEPTED;
  }

  if (u.role === "service" && (order.service_provider_id === u.id || order.provider_id === u.id)) {
    return [DELIVERY_STATUS.DELIVERING, DELIVERY_STATUS.DELIVERED].includes(next);
  }

  return false;
}

async function afterStatusSideEffects(sb, order, previousStatus, nextStatus, settlementRow) {
  const ds = normalizeIncomingStatus(nextStatus);
  const prevDs = normalizeIncomingStatus(previousStatus);

  if (prevDs === DELIVERY_STATUS.DRAFT && ds === DELIVERY_STATUS.PENDING) {
    try {
      await enqueueJobForPublishedOrder(order);
    } catch (qe) {
      logger.error({ err: qe.message || String(qe), orderId: order.id }, "[unifiedOrderStatus] enqueue draft→pending");
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

  if (order.id) {
    broadcastOrderPatch(String(order.id), orderPatchFromRow(order));
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
    if (!canPatchOrderStatus(order, appUser, nextStatus)) {
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
    const svcOut = await completeServiceOrder(sb, id, order.provider_id || order.service_provider_id || appUser.id, {
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
    if (!canPatchOrderStatus(order, appUser, nextStatus)) {
      return { data: null, error: new Error("Forbidden") };
    }
    if (!isValidDeliveryTransition(current, nextStatus)) {
      return { data: null, error: new Error(`Invalid transition ${current} → ${nextStatus}`) };
    }

    const patch = buildOrderStatusPatch(nextStatus);
    if (nextStatus === DELIVERY_STATUS.DELIVERED && appUser.role === "driver" && !order.driver_id) {
      patch.driver_id = appUser.id;
    }

    const { data, error } = await sb.from("orders").update(patch).eq("id", id).select().single();
    if (error) return { data: null, error };

    let settlementRow = null;
    if (nextStatus === DELIVERY_STATUS.DELIVERED) {
      settlementRow = await settleDeliveredOrderLedgerOnly(sb, id, "unified:delivered");
      if (
        settlementRow &&
        settlementRow.ok !== true &&
        settlementRow.ok !== "true" &&
        settlementRow.reason !== "already_settled" &&
        !settlementRow.skipped
      ) {
        logger.warn({ orderId: id, result: settlementRow }, "[unifiedOrderStatus] ledger settlement");
      }
    }

    await afterStatusSideEffects(sb, data, current, nextStatus, settlementRow);
    return { data, error: null, entity: "order", settlement: settlementRow };
  }
}

module.exports = {
  patchUnifiedOrderStatus,
  canPatchOrderStatus,
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
};
