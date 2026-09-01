/**
 * انتقالات الحالة حسب الدور — فوق isValidDeliveryTransition.
 */

const { isValidDeliveryTransition, deliveryLifecycleIndex } = require("./helpers");
const { isMerchantDispatchOrder } = require("./driverStoreHandoff");
const { DELIVERY_STATUS } = require("../domain/orders/constants");

function isCancelledStatus(status) {
  const x = String(status || "")
    .trim()
    .toLowerCase();
  return x === "cancelled" || x === "canceled" || x === "cancelled_by_customer";
}

function roleOf(appUser) {
  return String(appUser?.role || "")
    .trim()
    .toLowerCase();
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function assertActorDeliveryTransition(order, appUser, from, to) {
  const role = roleOf(appUser);
  const current = String(from || "")
    .trim()
    .toLowerCase();
  const next = String(to || "")
    .trim()
    .toLowerCase();

  if (!next) return { ok: false, message: "status required" };

  if (role === "admin") {
    if (current === next) return { ok: true };
    if (isValidDeliveryTransition(current, next)) return { ok: true };
    if (isCancelledStatus(next) && !isCancelledStatus(current)) return { ok: true };
    return { ok: false, message: `Invalid transition ${current} → ${next}` };
  }

  if (isCancelledStatus(current) && next === DELIVERY_STATUS.DELIVERED) {
    return { ok: false, message: "لا يمكن تسليم طلب ملغي" };
  }

  if (role === "customer" && isCancelledStatus(next)) {
    if (deliveryLifecycleIndex(current) >= 4) {
      return { ok: false, message: "لا يمكن إلغاء الطلب بعد الاستلام" };
    }
  }

  if (role === "driver" && isMerchantDispatchOrder(order)) {
    const pickupDone = ["picked_up", "picked", "delivering", "delivered"].includes(current);
    if (next === DELIVERY_STATUS.DELIVERED && !pickupDone) {
      return { ok: false, message: "يجب استلام الطلب من المتجر قبل التسليم" };
    }
    if (next === DELIVERY_STATUS.DELIVERING && current === DELIVERY_STATUS.ACCEPTED) {
      return { ok: false, message: "يجب استلام الطلب من المتجر أولاً" };
    }
  }

  if (["store", "merchant", "restaurant"].includes(role) && next === DELIVERY_STATUS.DELIVERED) {
    return { ok: false, message: "التاجر لا يغيّر الحالة إلى مسلَّم" };
  }

  if (!isValidDeliveryTransition(current, next) && !isCancelledStatus(next)) {
    return { ok: false, message: `Invalid transition ${current} → ${next}` };
  }

  return { ok: true };
}

function isDriverRecordOffline(drv) {
  if (!drv) return true;
  if (drv.active === false || drv.active === "false" || drv.active === 0) return true;
  const st = String(drv.status || "").toLowerCase();
  if (st && st !== "approved") return true;
  if (drv.online === false || drv.is_online === false) return true;
  const avail = String(drv.availability || drv.online_status || "").toLowerCase();
  if (avail === "offline" || avail === "unavailable") return true;
  return false;
}

module.exports = {
  assertActorDeliveryTransition,
  isDriverRecordOffline,
};
