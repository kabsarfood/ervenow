/**
 * إجراءات طلبات تلميع المركبات — رفض · إعادة نشر · تحديث الحالة
 */

const { updateOrdersResilient } = require("../utils/idempotency");
const { buildOrderStatusPatch } = require("../domain/orders/orderStatus");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const {
  isCarPolishingOrder,
  orderData,
  CP_STATUS,
  mergeCarPolishingData,
  acceptCpStatusFromOrder,
  deliveryStatusForCpTransition,
  reasonLabel,
  PROVIDER_REJECT_REASONS,
  PROVIDER_CANCEL_REASONS,
} = require("../utils/carPolishingWorkflow");
const { notifyProvidersForBooking } = require("./serviceBookingNotify");
const { notifyCustomer, notifyProviderForOrder } = require("./notificationEvents");

function appendRejectEntry(data, providerId, reasonCode, reasonText, kind) {
  const list = Array.isArray(data.rejected_providers) ? [...data.rejected_providers] : [];
  list.push({
    provider_id: String(providerId),
    reason_code: reasonCode || "other",
    reason_text: reasonText || "",
    kind: kind || "reject",
    at: new Date().toISOString(),
  });
  return list;
}

async function rejectCarPolishingBooking(sb, order, providerId, body) {
  if (!isCarPolishingOrder(order)) return { ok: false, status: 400, message: "not car_polishing" };
  const ds = String(order.delivery_status || "new").toLowerCase();
  if (!["new", "pending"].includes(ds)) {
    return { ok: false, status: 400, message: "الطلب غير متاح للرفض" };
  }
  if (order.provider_id) {
    return { ok: false, status: 409, message: "تم حجز الطلب من مزود آخر" };
  }

  const reasonCode = String(body?.reason_code || body?.reason || "other").trim();
  const reasonText =
    String(body?.reason_text || body?.note || "").trim() ||
    reasonLabel(PROVIDER_REJECT_REASONS, reasonCode, "رفض الطلب");

  const data = orderData(order);
  const merged = mergeCarPolishingData(data, {
    rejected_providers: appendRejectEntry(data, providerId, reasonCode, reasonText, "reject"),
    cp_status: CP_STATUS.NEW,
  });

  const { data: updated, error } = await updateOrdersResilient(
    sb,
    { data: merged, updated_at: new Date().toISOString() },
    (q) => q.eq("id", order.id).in("delivery_status", ["new", "pending"]).is("provider_id", null)
  );
  if (error) return { ok: false, status: 400, message: error.message || String(error) };
  if (!updated) return { ok: false, status: 409, message: "تعذر رفض الطلب" };

  return { ok: true, order: updated, message: "تم رفض الطلب — سيظهر لمزودين آخرين" };
}

async function republishCarPolishingBooking(sb, order, providerId, body) {
  if (!isCarPolishingOrder(order)) return { ok: false, status: 400, message: "not car_polishing" };
  const pid = String(providerId || "");
  if (String(order.provider_id || "") !== pid) {
    return { ok: false, status: 403, message: "غير مصرح" };
  }

  const reasonCode = String(body?.reason_code || body?.reason || "other").trim();
  const reasonText =
    String(body?.reason_text || body?.note || "").trim() ||
    reasonLabel(PROVIDER_CANCEL_REASONS, reasonCode, "إلغاء المهمة");

  const data = orderData(order);
  const merged = mergeCarPolishingData(data, {
    rejected_providers: appendRejectEntry(data, providerId, reasonCode, reasonText, "cancel_task"),
    cp_status: CP_STATUS.NEW,
    cp_phase: null,
    last_republish_at: new Date().toISOString(),
    last_republish_reason: reasonText,
  });

  const patch = {
    provider_id: null,
    delivery_status: DELIVERY_STATUS.NEW,
    updated_at: new Date().toISOString(),
    data: merged,
    reserved_at: null,
  };

  const { data: updated, error } = await updateOrdersResilient(sb, patch, (q) =>
    q.eq("id", order.id).eq("provider_id", pid)
  );
  if (error) return { ok: false, status: 400, message: error.message || String(error) };
  if (!updated) return { ok: false, status: 409, message: "تعذر إعادة نشر الطلب" };

  try {
    if (updated.customer_id) {
      await notifyCustomer(
        sb,
        updated.customer_id,
        "customer.order.received",
        "تحديث الطلب",
        `تعذّر تنفيذ طلبك رقم ${updated.order_number || updated.id} من المزود الحالي — جاري البحث عن مزود آخر.`,
        updated
      );
    }
    await notifyProvidersForBooking(sb, updated);
    if (updated.customer_id) {
      await notifyCustomer(
        sb,
        updated.customer_id,
        "customer.order.received",
        "إعادة نشر الطلب",
        `طلبك رقم ${updated.order_number || updated.id} عاد لقائمة الانتظار — سيتم إشعارك عند قبول مزود جديد.`,
        updated
      );
    }
  } catch (e) {
    console.error("[carPolishing] republish notify:", e && (e.message || e));
  }

  try {
    await notifyProviderForOrder(
      sb,
      updated,
      pid,
      "service.order.cancelled",
      "تم إلغاء المهمة",
      `تم إلغاء مهمة الطلب رقم ${updated.order_number || updated.id}.`,
      { reason: reasonText }
    );
  } catch (e) {
    console.error("[carPolishing] provider cancel notify:", e && (e.message || e));
  }

  return { ok: true, order: updated, message: "تم إلغاء المهمة وإعادة نشر الطلب" };
}

async function patchCarPolishingCpStatus(sb, order, providerId, nextCpStatus) {
  if (!isCarPolishingOrder(order)) return { ok: false, status: 400, message: "not car_polishing" };
  const cp = String(nextCpStatus || "").toLowerCase();
  const allowed = new Set([
    CP_STATUS.ON_THE_WAY,
    CP_STATUS.IN_PROGRESS,
    CP_STATUS.COMPLETED,
    CP_STATUS.SCHEDULED,
    CP_STATUS.ACCEPTED,
  ]);
  if (!allowed.has(cp)) return { ok: false, status: 400, message: "invalid cp status" };

  if (String(order.provider_id || "") !== String(providerId || "")) {
    return { ok: false, status: 403, message: "غير مصرح" };
  }

  const data = orderData(order);
  const cpPhase = cp === CP_STATUS.IN_PROGRESS ? "in_progress" : cp === CP_STATUS.ON_THE_WAY ? "on_the_way" : data.cp_phase;
  const merged = mergeCarPolishingData(data, {
    cp_status: cp,
    cp_phase: cpPhase,
  });

  const deliveryPatch = buildOrderStatusPatch(deliveryStatusForCpTransition(cp));
  const { data: updated, error } = await updateOrdersResilient(
    sb,
    {
      ...deliveryPatch,
      data: merged,
      updated_at: new Date().toISOString(),
    },
    (q) => q.eq("id", order.id).eq("provider_id", providerId)
  );
  if (error) return { ok: false, status: 400, message: error.message || String(error) };
  if (!updated) return { ok: false, status: 404, message: "Not found" };

  return { ok: true, order: updated, cp_status: cp };
}

function buildAcceptCarPolishingData(order) {
  const data = orderData(order);
  const cpStatus = acceptCpStatusFromOrder(data);
  return mergeCarPolishingData(data, {
    cp_status: cpStatus,
    cp_phase: null,
    accepted_at: new Date().toISOString(),
  });
}

module.exports = {
  rejectCarPolishingBooking,
  republishCarPolishingBooking,
  patchCarPolishingCpStatus,
  buildAcceptCarPolishingData,
};
