/**
 * Unified Available Actions — سياسة قراءة فقط.
 * تصف ما يسمح به المحرك الحالي لهذا الدور، دون تنفيذ أو تغيير Write APIs.
 */

const { getOrderProviderId } = require("../../utils/orderProviderId");
const { isMerchantDispatchOrder } = require("../../utils/driverStoreHandoff");
const { isInternalDeliveryOrder } = require("../../utils/driverDispatchOrders");
const { isCarPolishingOrder } = require("../../utils/carPolishingWorkflow");
const { isServicePhaseOrder } = require("../../utils/servicePhaseWorkflow");
const { deliveryLifecycleIndex } = require("../../utils/helpers");
const {
  WORKFLOW,
  UNIFIED_STATUS,
  resolveCustomerOrderWorkflow,
  resolveUnifiedOrderStatus,
} = require("./unifiedReadModel");

const ACTION = Object.freeze({
  ACCEPT: "accept",
  REJECT: "reject",
  CANCEL: "cancel",
  CANCEL_TASK: "cancel_task",
  START_PREPARING: "start_preparing",
  MARK_READY: "mark_ready",
  ACCEPT_DELIVERY: "accept_delivery",
  START_DELIVERY: "start_delivery",
  MARK_EN_ROUTE: "mark_en_route",
  START_SERVICE: "start_service",
  COMPLETE: "complete",
  CONFIRM: "confirm",
  ASSIGN_DRIVER: "assign_driver",
  REVIEW: "review",
});

const OPERATIONAL = new Set([
  ACTION.ACCEPT,
  ACTION.REJECT,
  ACTION.CANCEL,
  ACTION.CANCEL_TASK,
  ACTION.START_PREPARING,
  ACTION.MARK_READY,
  ACTION.ACCEPT_DELIVERY,
  ACTION.START_DELIVERY,
  ACTION.MARK_EN_ROUTE,
  ACTION.START_SERVICE,
  ACTION.COMPLETE,
  ACTION.CONFIRM,
  ACTION.ASSIGN_DRIVER,
]);

function idsEqual(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  return String(a) === String(b);
}

function normalizeRole(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase();
  if (r === "store" || r === "restaurant" || r === "merchant") return "merchant";
  if (r === "user") return "customer";
  return r;
}

function actorFromAppUser(appUser, extras) {
  if (!appUser) return null;
  return Object.assign(
    {
      role: extras && extras.role ? extras.role : appUser.role,
      userId: appUser.id,
    },
    extras && typeof extras === "object" ? extras : {}
  );
}

function normalizeActor(actor) {
  if (!actor) return null;
  if (typeof actor === "string") return { role: normalizeRole(actor), userId: null };
  return {
    role: normalizeRole(actor.role),
    userId: actor.userId || actor.id || null,
    storeId: actor.storeId || null,
  };
}

function orderData(order) {
  const d = order && order.data;
  if (d && typeof d === "object" && !Array.isArray(d)) return d;
  return {};
}

function rawDeliveryStatus(order) {
  return String((order && (order.delivery_status || order.status)) || "")
    .trim()
    .toLowerCase();
}

function isTerminalUnified(statusUnified) {
  return statusUnified === UNIFIED_STATUS.COMPLETED || statusUnified === UNIFIED_STATUS.CANCELLED;
}

function isOpenForCustomerCancel(order) {
  const ds = rawDeliveryStatus(order);
  if (!["draft", "new", "pending", "accepted"].includes(ds)) return false;
  if (deliveryLifecycleIndex(ds) >= 4) return false;
  if (isCarPolishingOrder(order) && (order.provider_id || getOrderProviderId(order))) return false;
  return true;
}

function isGasCentralOrder(order) {
  const st = String((order && order.service_type) || orderData(order).service_type || "")
    .trim()
    .toLowerCase();
  if (st !== "gas_delivery") return false;
  const mode = String((order && order.gas_mode) || orderData(order).gas_mode || "")
    .trim()
    .toLowerCase();
  return mode === "central_refill" || mode === "bulk";
}

function actorOwnsAsCustomer(order, actor) {
  if (!actor || actor.role !== "customer") return false;
  if (!actor.userId) return true;
  return idsEqual(order.customer_id, actor.userId);
}

function actorOwnsAsMerchant(order, actor) {
  if (!actor || actor.role !== "merchant") return false;
  if (!actor.userId && !actor.storeId) return true;
  if (actor.storeId && idsEqual(order.store_id, actor.storeId)) return true;
  if (actor.userId && idsEqual(order.merchant_id, actor.userId)) return true;
  return false;
}

function actorOwnsAsDriver(order, actor) {
  if (!actor || actor.role !== "driver") return false;
  if (!actor.userId) return true;
  return idsEqual(order.driver_id, actor.userId);
}

function actorOwnsAsProvider(order, actor) {
  if (!actor || (actor.role !== "service" && actor.role !== "transport")) return false;
  if (!actor.userId) return true;
  return idsEqual(getOrderProviderId(order), actor.userId);
}

function pushUnique(list, action) {
  if (!action || list.indexOf(action) !== -1) return;
  list.push(action);
}

function merchantActions(order, statusUnified) {
  const out = [];
  if (statusUnified === UNIFIED_STATUS.CREATED) pushUnique(out, ACTION.ACCEPT);
  if (statusUnified === UNIFIED_STATUS.ACCEPTED) pushUnique(out, ACTION.START_PREPARING);
  if (statusUnified === UNIFIED_STATUS.PREPARING) pushUnique(out, ACTION.MARK_READY);
  return out;
}

function driverActions(order, statusUnified, actor) {
  const out = [];
  const ds = rawDeliveryStatus(order);
  const assigned = Boolean(order.driver_id);
  const mine = assigned && actorOwnsAsDriver(order, actor);
  const merchantDispatch = isMerchantDispatchOrder(order);
  const driverDispatch = isInternalDeliveryOrder(order) || String(order.order_type || "").toLowerCase() === "delivery";

  if (!assigned && merchantDispatch && (statusUnified === UNIFIED_STATUS.READY || ds === "ready")) {
    pushUnique(out, ACTION.ACCEPT_DELIVERY);
  }
  if (!assigned && !merchantDispatch && (statusUnified === UNIFIED_STATUS.CREATED || ds === "new" || ds === "pending")) {
    if (driverDispatch || !order.store_id) pushUnique(out, ACTION.ACCEPT_DELIVERY);
  }

  if (!mine && assigned) return out;

  if (statusUnified === UNIFIED_STATUS.PICKED_UP) {
    pushUnique(out, ACTION.START_DELIVERY);
  }
  if (statusUnified === UNIFIED_STATUS.ASSIGNED && !merchantDispatch && mine) {
    pushUnique(out, ACTION.START_DELIVERY);
    pushUnique(out, ACTION.COMPLETE);
  }
  if (statusUnified === UNIFIED_STATUS.IN_TRANSIT || ds === "delivering") {
    pushUnique(out, ACTION.COMPLETE);
  }
  return out;
}

function serviceProviderActions(order, statusUnified) {
  const out = [];
  const assigned = Boolean(getOrderProviderId(order));
  const phase = isServicePhaseOrder(order);
  const polishing = isCarPolishingOrder(order);
  const gasCentral = isGasCentralOrder(order);

  if (!assigned && statusUnified === UNIFIED_STATUS.CREATED) {
    pushUnique(out, ACTION.ACCEPT);
    if (polishing) pushUnique(out, ACTION.REJECT);
    return out;
  }
  if (!assigned) return out;

  if (polishing || phase) {
    if (statusUnified === UNIFIED_STATUS.ASSIGNED || statusUnified === UNIFIED_STATUS.SCHEDULED) {
      pushUnique(out, ACTION.MARK_EN_ROUTE);
      if (polishing) pushUnique(out, ACTION.CANCEL_TASK);
    }
    if (statusUnified === UNIFIED_STATUS.IN_TRANSIT) {
      pushUnique(out, ACTION.START_SERVICE);
      if (polishing) pushUnique(out, ACTION.CANCEL_TASK);
    }
    if (statusUnified === UNIFIED_STATUS.IN_PROGRESS) {
      pushUnique(out, ACTION.COMPLETE);
      if (polishing) pushUnique(out, ACTION.CANCEL_TASK);
    }
    return out;
  }

  if (gasCentral) {
    if (statusUnified === UNIFIED_STATUS.ASSIGNED || statusUnified === UNIFIED_STATUS.ACCEPTED) {
      pushUnique(out, ACTION.START_SERVICE);
    }
    if (statusUnified === UNIFIED_STATUS.IN_TRANSIT) {
      pushUnique(out, ACTION.COMPLETE);
    }
    return out;
  }

  if (statusUnified === UNIFIED_STATUS.ASSIGNED || statusUnified === UNIFIED_STATUS.ACCEPTED) {
    pushUnique(out, ACTION.MARK_EN_ROUTE);
    pushUnique(out, ACTION.COMPLETE);
  }
  return out;
}

function transportProviderActions(order, statusUnified) {
  const out = [];
  const assigned = Boolean(getOrderProviderId(order));
  if (!assigned && statusUnified === UNIFIED_STATUS.CREATED) {
    pushUnique(out, ACTION.ACCEPT);
    return out;
  }
  if (!assigned) return out;
  if (statusUnified === UNIFIED_STATUS.ASSIGNED || statusUnified === UNIFIED_STATUS.ACCEPTED) {
    pushUnique(out, ACTION.COMPLETE);
  }
  return out;
}

function customerActions(order, statusUnified) {
  const out = [];
  if (isOpenForCustomerCancel(order) && !isTerminalUnified(statusUnified)) {
    pushUnique(out, ACTION.CANCEL);
  }
  const wf = resolveCustomerOrderWorkflow(order);
  if (
    (wf === WORKFLOW.SERVICE || wf === WORKFLOW.TRANSPORT) &&
    (statusUnified === UNIFIED_STATUS.IN_TRANSIT || rawDeliveryStatus(order) === "delivering")
  ) {
    pushUnique(out, ACTION.CONFIRM);
  }
  if (statusUnified === UNIFIED_STATUS.COMPLETED && order.rating == null) {
    pushUnique(out, ACTION.REVIEW);
  }
  return out;
}

function adminActions(order, statusUnified) {
  const out = [];
  if (!isTerminalUnified(statusUnified)) {
    pushUnique(out, ACTION.CANCEL);
    const wf = resolveCustomerOrderWorkflow(order);
    if (
      (wf === WORKFLOW.STORE || wf === WORKFLOW.DELIVERY || wf === WORKFLOW.INTERNAL_DELIVERY) &&
      !order.driver_id
    ) {
      pushUnique(out, ACTION.ASSIGN_DRIVER);
    }
  }
  return out;
}

/**
 * @param {object} order صف الطلب الأصلي
 * @param {string|{role:string,userId?:string,storeId?:string}} actor
 * @returns {string[]}
 */
function availableActionsForRole(order, actor) {
  const a = normalizeActor(actor);
  if (!order || !a || !a.role) return [];
  const workflow = resolveCustomerOrderWorkflow(order);
  const statusUnified = resolveUnifiedOrderStatus(order, workflow);

  if (a.role === "admin") return adminActions(order, statusUnified);

  if (a.role === "customer") {
    if (!actorOwnsAsCustomer(order, a)) return [];
    return customerActions(order, statusUnified);
  }

  if (a.role === "merchant") {
    if (workflow !== WORKFLOW.STORE) return [];
    if (!actorOwnsAsMerchant(order, a)) return [];
    return merchantActions(order, statusUnified);
  }

  if (a.role === "driver") {
    if (workflow === WORKFLOW.SERVICE || workflow === WORKFLOW.TRANSPORT) return [];
    return driverActions(order, statusUnified, a);
  }

  if (a.role === "service") {
    if (workflow !== WORKFLOW.SERVICE) return [];
    if (getOrderProviderId(order) && !actorOwnsAsProvider(order, a)) return [];
    return serviceProviderActions(order, statusUnified);
  }

  if (a.role === "transport") {
    if (workflow !== WORKFLOW.TRANSPORT) return [];
    if (getOrderProviderId(order) && !actorOwnsAsProvider(order, a)) return [];
    return transportProviderActions(order, statusUnified);
  }

  return [];
}

function operationalActionsOf(actions) {
  return (actions || []).filter((x) => OPERATIONAL.has(x));
}

module.exports = {
  ACTION,
  OPERATIONAL,
  actorFromAppUser,
  availableActionsForRole,
  operationalActionsOf,
  normalizeRole,
};
