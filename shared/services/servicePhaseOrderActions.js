/**
 * إجراءات مراحل الخدمات المنزلية + أسطوانات الغاز — sp_status
 */

const { updateOrdersResilient } = require("../utils/idempotency");
const { buildOrderStatusPatch } = require("../domain/orders/orderStatus");
const {
  isServicePhaseOrder,
  orderData,
  SP_STATUS,
  mergeServicePhaseData,
  acceptSpStatusFromOrder,
  deliveryStatusForSpTransition,
} = require("../utils/servicePhaseWorkflow");

async function patchServicePhaseStatus(sb, order, providerId, nextSpStatus) {
  if (!isServicePhaseOrder(order)) return { ok: false, status: 400, message: "not service_phase" };
  const sp = String(nextSpStatus || "").toLowerCase();
  const allowed = new Set([
    SP_STATUS.ON_THE_WAY,
    SP_STATUS.IN_PROGRESS,
    SP_STATUS.COMPLETED,
    SP_STATUS.SCHEDULED,
    SP_STATUS.ACCEPTED,
  ]);
  if (!allowed.has(sp)) return { ok: false, status: 400, message: "invalid sp status" };

  if (String(order.provider_id || "") !== String(providerId || "")) {
    return { ok: false, status: 403, message: "غير مصرح" };
  }

  const data = orderData(order);
  const spPhase =
    sp === SP_STATUS.IN_PROGRESS ? "in_progress" : sp === SP_STATUS.ON_THE_WAY ? "on_the_way" : data.sp_phase;
  const merged = mergeServicePhaseData(data, {
    sp_status: sp,
    sp_phase: spPhase,
  });

  const deliveryPatch = buildOrderStatusPatch(deliveryStatusForSpTransition(sp));
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

  return { ok: true, order: updated, sp_status: sp };
}

function buildAcceptServicePhaseData(order) {
  const data = orderData(order);
  const spStatus = acceptSpStatusFromOrder(data);
  return mergeServicePhaseData(data, {
    sp_status: spStatus,
    sp_phase: null,
    accepted_at: new Date().toISOString(),
  });
}

module.exports = {
  patchServicePhaseStatus,
  buildAcceptServicePhaseData,
};
