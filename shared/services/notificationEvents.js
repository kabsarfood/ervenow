/**
 * ERVENOW — Notification Events (Flow Separation 3.0 Completion)
 * جميع الإشعارات التشغيلية تمر عبر createRoutedNotification مع event + target_portal + portal_type
 */

const { createRoutedNotification, mapPortalToRecipientType } = require("../utils/notificationPortalRouting");
const { resolveOrderPortalType } = require("../utils/orderPortalRouting");
const { resolvePortalRole } = require("../utils/resolvePortalRole");
const { notifyStoreInApp, resolveStoreMerchantUserId } = require("./platformNotify");
const { findUserByPhone } = require("../utils/userPhoneLookup");
const { normalizePhone } = require("../utils/phone");
const { logger } = require("../utils/logger");

/** @type {Record<string, { event: string, target_portal: string, target_role: string, route: string }>} */
const NOTIFICATION_EVENT_CATALOG = {
  "merchant.order.new": {
    event: "merchant.order.new",
    target_portal: "merchant",
    target_role: "merchant",
    route: "checkout/service · unifiedOrderStatus",
  },
  "merchant.order.cancelled": {
    event: "merchant.order.cancelled",
    target_portal: "merchant",
    target_role: "merchant",
    route: "delivery/cancel · unifiedOrderStatus",
  },
  "merchant.withdraw.approved": {
    event: "merchant.withdraw.approved",
    target_portal: "merchant",
    target_role: "merchant",
    route: "admin/withdrawals approve",
  },
  "merchant.withdraw.rejected": {
    event: "merchant.withdraw.rejected",
    target_portal: "merchant",
    target_role: "merchant",
    route: "admin/withdrawals reject",
  },
  "driver.order.ready": {
    event: "driver.order.ready",
    target_portal: "driver",
    target_role: "driver",
    route: "unifiedOrderStatus READY · driver/notify",
  },
  "driver.task.assigned": {
    event: "driver.task.assigned",
    target_portal: "driver",
    target_role: "driver",
    route: "admin/assign · delivery/accept",
  },
  "driver.task.cancelled": {
    event: "driver.task.cancelled",
    target_portal: "driver",
    target_role: "driver",
    route: "delivery/cancel · unifiedOrderStatus",
  },
  "driver.withdraw.approved": {
    event: "driver.withdraw.approved",
    target_portal: "driver",
    target_role: "driver",
    route: "admin/withdrawals approve",
  },
  "driver.withdraw.rejected": {
    event: "driver.withdraw.rejected",
    target_portal: "driver",
    target_role: "driver",
    route: "admin/withdrawals reject",
  },
  "service.request.new": {
    event: "service.request.new",
    target_portal: "service",
    target_role: "service",
    route: "serviceBookingNotify · unifiedOrderStatus",
  },
  "service.schedule.updated": {
    event: "service.schedule.updated",
    target_portal: "service",
    target_role: "service",
    route: "order/:id/details patch",
  },
  "service.order.cancelled": {
    event: "service.order.cancelled",
    target_portal: "service",
    target_role: "service",
    route: "delivery/cancel · unifiedOrderStatus",
  },
  "service.withdraw.approved": {
    event: "service.withdraw.approved",
    target_portal: "service",
    target_role: "service",
    route: "admin/withdrawals approve",
  },
  "service.withdraw.rejected": {
    event: "service.withdraw.rejected",
    target_portal: "service",
    target_role: "service",
    route: "admin/withdrawals reject",
  },
  "transport.request.new": {
    event: "transport.request.new",
    target_portal: "transport",
    target_role: "transport",
    route: "carTransportNotify · unifiedOrderStatus",
  },
  "transport.destination.updated": {
    event: "transport.destination.updated",
    target_portal: "transport",
    target_role: "transport",
    route: "order/:id/details patch",
  },
  "transport.task.cancelled": {
    event: "transport.task.cancelled",
    target_portal: "transport",
    target_role: "transport",
    route: "delivery/cancel · unifiedOrderStatus",
  },
  "transport.withdraw.approved": {
    event: "transport.withdraw.approved",
    target_portal: "transport",
    target_role: "transport",
    route: "admin/withdrawals approve",
  },
  "transport.withdraw.rejected": {
    event: "transport.withdraw.rejected",
    target_portal: "transport",
    target_role: "transport",
    route: "admin/withdrawals reject",
  },
  "driver.payment.settled": {
    event: "driver.payment.settled",
    target_portal: "driver",
    target_role: "driver",
    route: "unifiedOrderStatus DELIVERED settlement",
  },
  "service.payment.settled": {
    event: "service.payment.settled",
    target_portal: "service",
    target_role: "service",
    route: "unifiedOrderStatus DELIVERED settlement",
  },
  "transport.payment.settled": {
    event: "transport.payment.settled",
    target_portal: "transport",
    target_role: "transport",
    route: "unifiedOrderStatus DELIVERED settlement",
  },
  "wallet.topup": {
    event: "wallet.topup",
    target_portal: "*",
    target_role: "*",
    route: "wallet/topup-request · redeem-code · ledger/deposit",
  },
  "wallet.refund": {
    event: "wallet.refund",
    target_portal: "*",
    target_role: "*",
    route: "wallet/ledger/refund",
  },
  "account.lifecycle": {
    event: "account.lifecycle",
    target_portal: "*",
    target_role: "*",
    route: "admin/account lifecycle",
  },
  "customer.order.received": {
    event: "customer.order.received",
    target_portal: "customer",
    target_role: "customer",
    route: "deliveryOrderCreateShared",
  },
  "customer.order.accepted": {
    event: "customer.order.accepted",
    target_portal: "customer",
    target_role: "customer",
    route: "unifiedOrderStatus · delivery/accept",
  },
  "customer.order.in_progress": {
    event: "customer.order.in_progress",
    target_portal: "customer",
    target_role: "customer",
    route: "unifiedOrderStatus PREPARING",
  },
  "customer.driver.en_route": {
    event: "customer.driver.en_route",
    target_portal: "customer",
    target_role: "customer",
    route: "unifiedOrderStatus DELIVERING",
  },
  "customer.order.delivered": {
    event: "customer.order.delivered",
    target_portal: "customer",
    target_role: "customer",
    route: "unifiedOrderStatus DELIVERED",
  },
  "customer.order.cancelled": {
    event: "customer.order.cancelled",
    target_portal: "customer",
    target_role: "customer",
    route: "delivery/cancel · unifiedOrderStatus",
  },
  "customer.schedule.updated": {
    event: "customer.schedule.updated",
    target_portal: "customer",
    target_role: "customer",
    route: "order/:id/details patch",
  },
  "customer.destination.updated": {
    event: "customer.destination.updated",
    target_portal: "customer",
    target_role: "customer",
    route: "order/:id/details patch",
  },
};

const CANCEL_STATUSES = new Set([
  "cancelled",
  "canceled",
  "cancelled_by_customer",
  "canceled_by_customer",
]);

function catalogEntry(eventKey) {
  return NOTIFICATION_EVENT_CATALOG[eventKey] || null;
}

function orderPayload(order, extra) {
  const portal_type = resolveOrderPortalType(order);
  return Object.assign(
    {
      portal_type,
      order_id: order && order.id,
      order_number: (order && order.order_number) || null,
      delivery_status: (order && (order.delivery_status || order.status)) || null,
      service_type: (order && order.service_type) || null,
      order_type: (order && order.order_type) || null,
    },
    extra || {}
  );
}

function portalWalletEvent(portal) {
  const p = String(portal || "").toLowerCase();
  if (p === "merchant") return { approved: "merchant.withdraw.approved", rejected: "merchant.withdraw.rejected" };
  if (p === "driver") return { approved: "driver.withdraw.approved", rejected: "driver.withdraw.rejected" };
  if (p === "transport") return { approved: "transport.withdraw.approved", rejected: "transport.withdraw.rejected" };
  return { approved: "service.withdraw.approved", rejected: "service.withdraw.rejected" };
}

function resolveWalletPortal(user) {
  if (user && user.portal) return String(user.portal).toLowerCase();
  const role = String((user && user.role) || "").toLowerCase();
  if (role === "driver") return "driver";
  if (role === "store" || role === "merchant" || role === "restaurant") return "merchant";
  if (role === "service") return resolvePortalRole(user).portalRole;
  return "customer";
}

async function emitEvent(sb, input) {
  if (!sb || !input || !input.recipient_id) return null;
  const cat = catalogEntry(input.event);
  const target_portal = input.target_portal || (cat && cat.target_portal) || input.portal_type || null;
  const target_role = input.target_role || (cat && cat.target_role) || target_portal;
  const payload = Object.assign(
    {
      event: input.event,
      route: (cat && cat.route) || input.route || null,
    },
    input.payload || {}
  );
  if (target_portal) {
    payload.target_portal = target_portal;
    payload.portal_type = payload.portal_type || target_portal;
  }
  if (target_role) payload.target_role = target_role;

  try {
    return await createRoutedNotification(sb, {
      recipient_type: input.recipient_type || mapPortalToRecipientType(target_portal || "customer"),
      recipient_id: String(input.recipient_id),
      target_portal,
      target_role,
      title: input.title,
      message: input.message,
      type: input.type || "order",
      source: input.source || "ervenow",
      order: input.order,
      payload,
    });
  } catch (e) {
    logger.warn(
      { err: e.message || String(e), event: input.event, recipient_id: input.recipient_id },
      "[notificationEvents] emit failed"
    );
    return null;
  }
}

async function notifyCustomer(sb, customerId, eventKey, title, message, order, extraPayload) {
  if (!customerId) return null;
  return emitEvent(sb, {
    event: eventKey,
    recipient_id: customerId,
    recipient_type: "customer",
    target_portal: "customer",
    target_role: "customer",
    title,
    message,
    type: eventKey.includes("withdraw") ? "wallet" : eventKey.includes("delivered") ? "delivery" : "order",
    source: order && resolveOrderPortalType(order) === "merchant" ? "store" : "delivery",
    order,
    payload: order ? orderPayload(order, extraPayload) : extraPayload || {},
  });
}

async function notifyMerchantForOrder(sb, order, eventKey, title, message, extraPayload) {
  if (!order) return null;
  const merchantUserId =
    order.merchant_id ||
    (order.store_id && (await resolveStoreMerchantUserId(sb, order.store_id)));
  if (!merchantUserId) return null;
  return notifyStoreInApp(sb, {
    merchantUserId,
    title,
    message,
    type: eventKey.includes("withdraw") ? "wallet" : "order",
    source: "store",
    payload: Object.assign(orderPayload(order, { event: eventKey }), extraPayload || {}),
  });
}

async function notifyDriverUser(sb, driverUserId, eventKey, title, message, order, extraPayload) {
  if (!driverUserId) return null;
  return emitEvent(sb, {
    event: eventKey,
    recipient_id: driverUserId,
    recipient_type: "driver",
    target_portal: "driver",
    target_role: "driver",
    title,
    message,
    type: eventKey.includes("withdraw") ? "wallet" : "delivery",
    source: "delivery",
    order,
    payload: order ? orderPayload(order, extraPayload) : extraPayload || {},
  });
}

async function notifyProviderForOrder(sb, order, providerUserId, eventKey, title, message, extraPayload) {
  if (!providerUserId || !order) return null;
  const portal = resolveOrderPortalType(order);
  const targetPortal = portal === "transport" ? "transport" : "service";
  return emitEvent(sb, {
    event: eventKey,
    recipient_id: providerUserId,
    recipient_type: "provider",
    target_portal: targetPortal,
    target_role: targetPortal,
    title,
    message,
    type: "order",
    source: "delivery",
    order,
    payload: orderPayload(order, extraPayload),
  });
}

async function resolveDriverUserId(sb, driverRow) {
  if (!sb || !driverRow) return null;
  const phone = normalizePhone(driverRow.phone);
  if (!phone) return null;
  const found = await findUserByPhone(sb, phone, "id, role");
  return found && found.data && found.data.id ? String(found.data.id) : null;
}

async function notifyDriversOrderReady(sb, order, driverRows) {
  if (!sb || !order || !Array.isArray(driverRows)) return 0;
  let sent = 0;
  for (const d of driverRows) {
    const userId = await resolveDriverUserId(sb, d);
    if (!userId) continue;
    const row = await notifyDriverUser(
      sb,
      userId,
      "driver.order.ready",
      "طلب جاهز للاستلام",
      `طلب ${order.order_number || order.id} جاهز للاستلام من المتجر.`,
      order
    );
    if (row) sent += 1;
  }
  return sent;
}

async function notifyProvidersForNewBooking(sb, order, providerUserIds) {
  if (!sb || !order || !providerUserIds || !providerUserIds.length) return 0;
  const portal = resolveOrderPortalType(order);
  const eventKey = portal === "transport" ? "transport.request.new" : "service.request.new";
  const title = portal === "transport" ? "طلب نقل جديد" : "طلب خدمة جديد";
  const message =
    portal === "transport"
      ? `طلب نقل جديد رقم ${order.order_number || order.id}.`
      : `طلب خدمة جديد رقم ${order.order_number || order.id}.`;
  let sent = 0;
  const seen = new Set();
  for (const uid of providerUserIds) {
    const id = String(uid || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const row = await notifyProviderForOrder(sb, order, id, eventKey, title, message);
    if (row) sent += 1;
  }
  return sent;
}

async function lookupProviderUserIdsByPhones(sb, phones) {
  const ids = [];
  const seen = new Set();
  for (const phone of phones || []) {
    const found = await findUserByPhone(sb, phone, "id, role, service_type");
    const id = found && found.data && found.data.id ? String(found.data.id) : null;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function notifyOrderCancelled(sb, order) {
  if (!order) return;
  const portal = resolveOrderPortalType(order);
  const tasks = [];

  if (order.customer_id) {
    tasks.push(
      notifyCustomer(
        sb,
        order.customer_id,
        "customer.order.cancelled",
        "تم إلغاء الطلب",
        `تم إلغاء الطلب رقم ${order.order_number || order.id}.`,
        order
      )
    );
  }

  if (portal === "merchant") {
    tasks.push(
      notifyMerchantForOrder(
        sb,
        order,
        "merchant.order.cancelled",
        "إلغاء طلب",
        `تم إلغاء الطلب رقم ${order.order_number || order.id}.`
      )
    );
    if (order.driver_id) {
      tasks.push(
        notifyDriverUser(
          sb,
          order.driver_id,
          "driver.task.cancelled",
          "إلغاء مهمة",
          `تم إلغاء الطلب المُسنَد رقم ${order.order_number || order.id}.`,
          order
        )
      );
    }
  } else if (portal === "service") {
    if (order.provider_id) {
      tasks.push(
        notifyProviderForOrder(
          sb,
          order,
          order.provider_id,
          "service.order.cancelled",
          "إلغاء طلب خدمة",
          `تم إلغاء طلب الخدمة رقم ${order.order_number || order.id}.`,
          order
        )
      );
    }
  } else if (portal === "transport") {
    if (order.provider_id) {
      tasks.push(
        notifyProviderForOrder(
          sb,
          order,
          order.provider_id,
          "transport.task.cancelled",
          "إلغاء مهمة نقل",
          `تم إلغاء طلب النقل رقم ${order.order_number || order.id}.`,
          order
        )
      );
    }
  }

  await Promise.all(tasks);
}

async function notifyWithdrawApproved(sb, userId, userMeta, payload) {
  if (!userId) return null;
  const portal = resolveWalletPortal(userMeta);
  const ev = portalWalletEvent(portal).approved;
  return emitEvent(sb, {
    event: ev,
    recipient_id: userId,
    recipient_type: mapPortalToRecipientType(portal),
    target_portal: portal,
    target_role: portal,
    title: "تم اعتماد السحب",
    message: "تم اعتماد طلب السحب المالي الخاص بك.",
    type: "wallet",
    source: "wallet",
    payload: Object.assign({ portal_type: portal }, payload || {}),
  });
}

async function notifyWithdrawRejected(sb, userId, userMeta, payload) {
  if (!userId) return null;
  const portal = resolveWalletPortal(userMeta);
  const ev = portalWalletEvent(portal).rejected;
  const reason = payload && payload.reason ? String(payload.reason).trim() : "";
  const message = reason
    ? `لم يُعتمد طلب السحب — السبب: ${reason}`
    : "لم يُعتمد طلب السحب — راجع لوحة المحفظة أو تواصل مع الدعم.";
  return emitEvent(sb, {
    event: ev,
    recipient_id: userId,
    recipient_type: mapPortalToRecipientType(portal),
    target_portal: portal,
    target_role: portal,
    title: "تم رفض السحب",
    message,
    type: "wallet",
    source: "wallet",
    payload: Object.assign({ portal_type: portal, rejection_reason: reason || null }, payload || {}),
  });
}

async function notifyWalletCredit(sb, userId, userMeta, eventKey, title, message, payload) {
  if (!userId) return null;
  const portal = resolveWalletPortal(userMeta);
  return emitEvent(sb, {
    event: eventKey,
    recipient_id: userId,
    recipient_type: mapPortalToRecipientType(portal),
    target_portal: portal === "customer" ? "customer" : portal,
    target_role: portal === "customer" ? "customer" : portal,
    title,
    message,
    type: "wallet",
    source: "wallet",
    payload: Object.assign({ portal_type: portal }, payload || {}),
  });
}

async function notifyDriversInAppByPhones(sb, order, phones) {
  if (!sb || !order || !phones || !phones.length) return 0;
  const rows = phones.map((phone) => ({ phone }));
  return notifyDriversOrderReady(sb, order, rows);
}

async function notifyProvidersInAppByPhones(sb, order, phones) {
  if (!sb || !order || !phones || !phones.length) return 0;
  const ids = await lookupProviderUserIdsByPhones(sb, phones);
  return notifyProvidersForNewBooking(sb, order, ids);
}

async function notifyServiceScheduleUpdated(sb, order, providerUserId) {
  if (!order) return;
  const tasks = [];
  if (providerUserId) {
    tasks.push(
      notifyProviderForOrder(
        sb,
        order,
        providerUserId,
        "service.schedule.updated",
        "تحديث الموعد",
        `تم تحديث موعد طلب الخدمة رقم ${order.order_number || order.id}.`,
        { scheduled_at: order.scheduled_at || null }
      )
    );
  }
  if (order.customer_id) {
    tasks.push(
      notifyCustomer(
        sb,
        order.customer_id,
        "customer.schedule.updated",
        "تحديث الموعد",
        `تم تحديث موعد طلبك رقم ${order.order_number || order.id}.`,
        order,
        { scheduled_at: order.scheduled_at || null }
      )
    );
  }
  await Promise.all(tasks);
}

async function notifyTransportDestinationUpdated(sb, order, providerUserId) {
  if (!order) return;
  const tasks = [];
  if (providerUserId) {
    tasks.push(
      notifyProviderForOrder(
        sb,
        order,
        providerUserId,
        "transport.destination.updated",
        "تعديل الوجهة",
        `تم تعديل وجهة طلب النقل رقم ${order.order_number || order.id}.`,
        {
          drop_address: order.drop_address || null,
          drop_lat: order.drop_lat != null ? order.drop_lat : null,
          drop_lng: order.drop_lng != null ? order.drop_lng : null,
        }
      )
    );
  }
  if (order.customer_id) {
    tasks.push(
      notifyCustomer(
        sb,
        order.customer_id,
        "customer.destination.updated",
        "تعديل الوجهة",
        `تم تعديل وجهة طلبك رقم ${order.order_number || order.id}.`,
        order,
        {
          drop_address: order.drop_address || null,
          drop_lat: order.drop_lat != null ? order.drop_lat : null,
          drop_lng: order.drop_lng != null ? order.drop_lng : null,
        }
      )
    );
  }
  await Promise.all(tasks);
}

function destinationFieldsChanged(before, after) {
  if (!before || !after) return false;
  return (
    String(before.drop_address || "") !== String(after.drop_address || "") ||
    String(before.drop_lat ?? "") !== String(after.drop_lat ?? "") ||
    String(before.drop_lng ?? "") !== String(after.drop_lng ?? "")
  );
}

function scheduleFieldChanged(before, after) {
  if (!before || !after) return false;
  return String(before.scheduled_at || "") !== String(after.scheduled_at || "");
}

async function notifyOrderFieldChanges(sb, before, after) {
  if (!sb || !before || !after) return;
  const { getOrderProviderId } = require("../utils/orderProviderId");
  const portal = resolveOrderPortalType(after);
  const providerId = getOrderProviderId(after);

  if (portal === "service" && scheduleFieldChanged(before, after)) {
    await notifyServiceScheduleUpdated(sb, after, providerId);
  }
  if (portal === "transport" && destinationFieldsChanged(before, after)) {
    await notifyTransportDestinationUpdated(sb, after, providerId);
  }
}

function isCancelledStatus(status) {
  return CANCEL_STATUSES.has(String(status || "").trim().toLowerCase());
}

function getNotificationAuditReport() {
  return Object.values(NOTIFICATION_EVENT_CATALOG).map((row) => ({
    Event: row.event,
    Portal: row.target_portal,
    Recipient: row.target_role,
    Route: row.route,
  }));
}

module.exports = {
  NOTIFICATION_EVENT_CATALOG,
  catalogEntry,
  emitEvent,
  notifyCustomer,
  notifyMerchantForOrder,
  notifyDriverUser,
  notifyProviderForOrder,
  notifyDriversOrderReady,
  notifyProvidersForNewBooking,
  lookupProviderUserIdsByPhones,
  notifyOrderCancelled,
  notifyWithdrawApproved,
  notifyWithdrawRejected,
  notifyWalletCredit,
  notifyDriversInAppByPhones,
  notifyProvidersInAppByPhones,
  notifyServiceScheduleUpdated,
  notifyTransportDestinationUpdated,
  notifyOrderFieldChanges,
  destinationFieldsChanged,
  scheduleFieldChanged,
  resolveDriverUserId,
  resolveWalletPortal,
  isCancelledStatus,
  getNotificationAuditReport,
};
