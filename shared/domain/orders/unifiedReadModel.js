/**
 * Unified Order Read Model — طبقة قراءة فقط فوق صف orders.
 * لا تكتب في DB ولا تغيّر delivery_status / الصلاحيات / التسوية.
 */

const { resolveOrderPortalType } = require("../../utils/orderPortalRouting");
const { isInternalDeliveryOrder } = require("../../utils/driverDispatchOrders");
const { getOrderProviderId } = require("../../utils/orderProviderId");
const { isCarPolishingOrder, resolveCpStatus } = require("../../utils/carPolishingWorkflow");
const { isServicePhaseOrder, resolveSpStatus } = require("../../utils/servicePhaseWorkflow");

const WORKFLOW = Object.freeze({
  STORE: "store",
  SERVICE: "service",
  TRANSPORT: "transport",
  INTERNAL_DELIVERY: "internal_delivery",
  DELIVERY: "delivery",
  UNKNOWN: "unknown",
});

const UNIFIED_STATUS = Object.freeze({
  CREATED: "created",
  ACCEPTED: "accepted",
  PREPARING: "preparing",
  READY: "ready",
  ASSIGNED: "assigned",
  SCHEDULED: "scheduled",
  PICKED_UP: "picked_up",
  IN_PROGRESS: "in_progress",
  IN_TRANSIT: "in_transit",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
});

const CURRENT_ACTOR_TYPE = Object.freeze({
  MERCHANT: "merchant",
  DRIVER: "driver",
  SERVICE_PROVIDER: "service_provider",
  TRANSPORT_PROVIDER: "transport_provider",
});

/** @deprecated اسم سابق — نفس قيم current_actor_type */
const FULFILLER_TYPE = CURRENT_ACTOR_TYPE;

const KNOWN_DELIVERY_STATUS = new Set([
  "draft",
  "new",
  "pending",
  "accepted",
  "preparing",
  "ready",
  "picked",
  "picked_up",
  "delivering",
  "delivered",
  "cancelled",
  "cancelled_by_customer",
  "canceled",
  "onroad",
  "completed",
]);

const KNOWN_PHASE_STATUS = new Set([
  "new",
  "accepted",
  "scheduled",
  "on_the_way",
  "in_progress",
  "completed",
  "cancelled",
]);

const DRIVER_HANDOFF = new Set(["picked", "picked_up", "delivering", "delivered"]);

function orderData(order) {
  const d = order && order.data;
  if (d && typeof d === "object" && !Array.isArray(d)) return d;
  return {};
}

function rawDeliveryStatus(order) {
  if (!order || order.delivery_status == null) return "";
  return String(order.delivery_status).trim().toLowerCase();
}

function hasMerchantRef(order) {
  return Boolean(order && (order.store_id || order.merchant_id));
}

function hasPickupDrop(order) {
  if (!order) return false;
  const plat = Number(order.pickup_lat);
  const plng = Number(order.pickup_lng);
  const dlat = Number(order.drop_lat);
  const dlng = Number(order.drop_lng);
  return [plat, plng, dlat, dlng].every((n) => Number.isFinite(n));
}

/**
 * @param {object|null|undefined} order
 * @returns {string}
 */
function resolveCustomerOrderWorkflow(order) {
  if (!order || typeof order !== "object") return WORKFLOW.UNKNOWN;
  if (isInternalDeliveryOrder(order)) return WORKFLOW.INTERNAL_DELIVERY;

  const ot = String(order.order_type || "").trim().toLowerCase();
  const portal = resolveOrderPortalType(order);

  if (portal === "transport") return WORKFLOW.TRANSPORT;
  if (portal === "service") return WORKFLOW.SERVICE;
  if (portal === "driver") return WORKFLOW.INTERNAL_DELIVERY;

  if (ot === "store" || ot === "restaurant" || order.store_id) return WORKFLOW.STORE;
  if (ot === "delivery") return WORKFLOW.DELIVERY;

  if (portal === "merchant") {
    if (hasPickupDrop(order) && !order.store_id) return WORKFLOW.DELIVERY;
    if (hasMerchantRef(order)) return WORKFLOW.STORE;
    return WORKFLOW.UNKNOWN;
  }

  return WORKFLOW.UNKNOWN;
}

function mapPhaseStatus(phase, hasAssignee) {
  const s = String(phase || "").trim().toLowerCase();
  if (!s) return UNIFIED_STATUS.UNKNOWN;
  if (!KNOWN_PHASE_STATUS.has(s)) return UNIFIED_STATUS.UNKNOWN;
  if (s === "new") return UNIFIED_STATUS.CREATED;
  if (s === "accepted") return hasAssignee ? UNIFIED_STATUS.ASSIGNED : UNIFIED_STATUS.ACCEPTED;
  if (s === "scheduled") return UNIFIED_STATUS.SCHEDULED;
  if (s === "on_the_way") return UNIFIED_STATUS.IN_TRANSIT;
  if (s === "in_progress") return UNIFIED_STATUS.IN_PROGRESS;
  if (s === "completed") return UNIFIED_STATUS.COMPLETED;
  if (s === "cancelled") return UNIFIED_STATUS.CANCELLED;
  return UNIFIED_STATUS.UNKNOWN;
}

function mapDeliveryStatus(ds, workflow, hasAssignee) {
  const s = String(ds || "").trim().toLowerCase();
  if (!s) return UNIFIED_STATUS.UNKNOWN;
  if (!KNOWN_DELIVERY_STATUS.has(s)) return UNIFIED_STATUS.UNKNOWN;

  if (s === "cancelled" || s === "cancelled_by_customer" || s === "canceled") {
    return UNIFIED_STATUS.CANCELLED;
  }
  if (s === "draft" || s === "new" || s === "pending") return UNIFIED_STATUS.CREATED;
  if (s === "preparing") return UNIFIED_STATUS.PREPARING;
  if (s === "ready") {
    if (workflow === WORKFLOW.STORE && hasAssignee) return UNIFIED_STATUS.ASSIGNED;
    return UNIFIED_STATUS.READY;
  }
  if (s === "picked" || s === "picked_up") return UNIFIED_STATUS.PICKED_UP;
  if (s === "delivering" || s === "onroad") {
    if (workflow === WORKFLOW.SERVICE) return UNIFIED_STATUS.IN_PROGRESS;
    return UNIFIED_STATUS.IN_TRANSIT;
  }
  if (s === "delivered" || s === "completed") return UNIFIED_STATUS.COMPLETED;
  if (s === "accepted") {
    if (workflow === WORKFLOW.STORE && hasAssignee) return UNIFIED_STATUS.ASSIGNED;
    if (
      hasAssignee &&
      (workflow === WORKFLOW.DELIVERY ||
        workflow === WORKFLOW.INTERNAL_DELIVERY ||
        workflow === WORKFLOW.SERVICE ||
        workflow === WORKFLOW.TRANSPORT)
    ) {
      return UNIFIED_STATUS.ASSIGNED;
    }
    return UNIFIED_STATUS.ACCEPTED;
  }
  return UNIFIED_STATUS.UNKNOWN;
}

/**
 * @param {object} order
 * @param {string} [workflow]
 * @returns {string}
 */
function resolveUnifiedOrderStatus(order, workflow) {
  const wf = workflow || resolveCustomerOrderWorkflow(order);
  const ds = rawDeliveryStatus(order);
  const providerId = getOrderProviderId(order);
  const driverId = order && order.driver_id;
  const hasProvider = Boolean(providerId);
  const hasDriver = Boolean(driverId);

  if (ds === "cancelled" || ds === "cancelled_by_customer" || ds === "canceled") {
    return UNIFIED_STATUS.CANCELLED;
  }

  if (wf === WORKFLOW.SERVICE || wf === WORKFLOW.TRANSPORT) {
    if (isCarPolishingOrder(order)) {
      return mapPhaseStatus(resolveCpStatus(order), hasProvider);
    }
    if (isServicePhaseOrder(order)) {
      return mapPhaseStatus(resolveSpStatus(order), hasProvider);
    }
  }

  return mapDeliveryStatus(ds, wf, hasProvider || hasDriver);
}

/**
 * الطرف المسؤول تشغيليًا عن الخطوة الحالية — ليس المستفيد المالي ولا مالك الطلب.
 * @param {object} order
 * @param {string} [workflow]
 * @returns {string|null}
 */
function resolveCurrentActorType(order, workflow) {
  if (!order) return null;
  const wf = workflow || resolveCustomerOrderWorkflow(order);
  const statusUnified = resolveUnifiedOrderStatus(order, wf);
  if (statusUnified === UNIFIED_STATUS.COMPLETED || statusUnified === UNIFIED_STATUS.CANCELLED) {
    return null;
  }
  const ds = rawDeliveryStatus(order);
  const providerId = getOrderProviderId(order);
  const driverId = order.driver_id;

  if (wf === WORKFLOW.INTERNAL_DELIVERY || wf === WORKFLOW.DELIVERY) {
    return driverId ? CURRENT_ACTOR_TYPE.DRIVER : null;
  }

  if (wf === WORKFLOW.TRANSPORT) {
    return providerId ? CURRENT_ACTOR_TYPE.TRANSPORT_PROVIDER : null;
  }

  if (wf === WORKFLOW.SERVICE) {
    return providerId ? CURRENT_ACTOR_TYPE.SERVICE_PROVIDER : null;
  }

  if (wf === WORKFLOW.STORE) {
    if (driverId && DRIVER_HANDOFF.has(ds)) return CURRENT_ACTOR_TYPE.DRIVER;
    if (driverId && (ds === "ready" || ds === "accepted")) return CURRENT_ACTOR_TYPE.DRIVER;
    if (hasMerchantRef(order)) return CURRENT_ACTOR_TYPE.MERCHANT;
    if (driverId) return CURRENT_ACTOR_TYPE.DRIVER;
    return null;
  }

  if (driverId) return CURRENT_ACTOR_TYPE.DRIVER;
  if (providerId) {
    const portal = resolveOrderPortalType(order);
    if (portal === "transport") return CURRENT_ACTOR_TYPE.TRANSPORT_PROVIDER;
    if (portal === "service") return CURRENT_ACTOR_TYPE.SERVICE_PROVIDER;
    return null;
  }
  if (hasMerchantRef(order)) return CURRENT_ACTOR_TYPE.MERCHANT;
  return null;
}

/** @deprecated استخدم resolveCurrentActorType */
function resolveFulfillerType(order, workflow) {
  return resolveCurrentActorType(order, workflow);
}

const CUSTOMER_STATUS_LABELS = Object.freeze({
  store: {
    created: "تم استلام طلبك",
    accepted: "تم قبول طلبك",
    preparing: "جاري تجهيز طلبك",
    ready: "طلبك جاهز للاستلام",
    assigned: "تم تعيين مندوب لطلبك",
    scheduled: "تم جدولة طلبك",
    picked_up: "المندوب استلم طلبك من المتجر",
    in_progress: "جاري تجهيز طلبك",
    in_transit: "طلبك في الطريق إليك",
    completed: "تم تسليم طلبك",
    cancelled: "تم إلغاء الطلب",
    unknown: "جاري متابعة طلبك",
  },
  service: {
    created: "تم تسجيل طلب الخدمة",
    accepted: "تم قبول طلب الخدمة",
    preparing: "جاري التحضير للخدمة",
    ready: "مزود الخدمة جاهز للبدء",
    assigned: "تم تعيين مزود الخدمة",
    scheduled: "تم جدولة موعد الخدمة",
    picked_up: "مزود الخدمة في الطريق",
    in_progress: "جاري تنفيذ الخدمة",
    in_transit: "مزود الخدمة في الطريق",
    completed: "اكتملت الخدمة",
    cancelled: "تم إلغاء طلب الخدمة",
    unknown: "جاري متابعة طلب الخدمة",
  },
  transport: {
    created: "تم تسجيل طلب النقل",
    accepted: "تم قبول طلب النقل",
    preparing: "جاري التحضير للنقل",
    ready: "مزود النقل جاهز",
    assigned: "تم تعيين مزود النقل",
    scheduled: "تم جدولة طلب النقل",
    picked_up: "تم استلام الشحنة",
    in_progress: "جاري تنفيذ النقل",
    in_transit: "مزود النقل في الطريق",
    completed: "اكتمل طلب النقل",
    cancelled: "تم إلغاء طلب النقل",
    unknown: "جاري متابعة طلب النقل",
  },
  internal_delivery: {
    created: "تم تسجيل طلب التوصيل",
    accepted: "تم قبول طلب التوصيل",
    preparing: "جاري تجهيز التوصيل",
    ready: "طلب التوصيل جاهز",
    assigned: "تم تعيين مندوب",
    scheduled: "تم جدولة التوصيل",
    picked_up: "المندوب استلم الشحنة",
    in_progress: "طلبك في الطريق إليك",
    in_transit: "طلبك في الطريق إليك",
    completed: "تم التسليم",
    cancelled: "تم إلغاء الطلب",
    unknown: "جاري متابعة التوصيل",
  },
  delivery: {
    created: "تم تسجيل طلب التوصيل",
    accepted: "تم قبول طلب التوصيل",
    preparing: "جاري تجهيز التوصيل",
    ready: "طلب التوصيل جاهز",
    assigned: "تم تعيين مندوب",
    scheduled: "تم جدولة التوصيل",
    picked_up: "المندوب استلم الشحنة",
    in_progress: "طلبك في الطريق إليك",
    in_transit: "طلبك في الطريق إليك",
    completed: "تم التسليم",
    cancelled: "تم إلغاء الطلب",
    unknown: "جاري متابعة التوصيل",
  },
  unknown: {
    created: "تم تسجيل الطلب",
    accepted: "تم قبول الطلب",
    preparing: "جاري التنفيذ",
    ready: "الطلب جاهز",
    assigned: "تم تعيين منفّذ",
    scheduled: "تم جدولة الطلب",
    picked_up: "تم الاستلام",
    in_progress: "جاري التنفيذ",
    in_transit: "الطلب في الطريق",
    completed: "اكتمل الطلب",
    cancelled: "تم إلغاء الطلب",
    unknown: "جاري متابعة الطلب",
  },
});

const MERCHANT_STATUS_LABELS = Object.freeze({
  store: {
    created: "طلب جديد",
    accepted: "مقبول",
    preparing: "جاري التجهيز",
    ready: "جاهز للاستلام",
    assigned: "بانتظار استلام المندوب",
    picked_up: "استلمه المندوب",
    in_progress: "جاري التجهيز",
    in_transit: "قيد التوصيل",
    completed: "تم التسليم",
    cancelled: "ملغى",
    unknown: "قيد المتابعة",
  },
});

const DRIVER_STATUS_LABELS = Object.freeze({
  store: {
    created: "طلب جديد",
    accepted: "بانتظار التجهيز",
    preparing: "قيد التجهيز",
    ready: "جاهز للاستلام",
    assigned: "معيّن لك",
    picked_up: "تم الاستلام من المتجر",
    in_transit: "في الطريق للعميل",
    in_progress: "في الطريق للعميل",
    completed: "تم التسليم",
    cancelled: "ملغى",
    unknown: "قيد المتابعة",
  },
  internal_delivery: {
    created: "طلب توصيل جديد",
    assigned: "معيّن لك",
    picked_up: "تم استلام الشحنة",
    in_transit: "في الطريق للعميل",
    in_progress: "في الطريق للعميل",
    completed: "تم التسليم",
    cancelled: "ملغى",
    unknown: "قيد المتابعة",
  },
  delivery: {
    created: "طلب توصيل جديد",
    assigned: "معيّن لك",
    picked_up: "تم استلام الشحنة",
    in_transit: "في الطريق للعميل",
    in_progress: "في الطريق للعميل",
    completed: "تم التسليم",
    cancelled: "ملغى",
    unknown: "قيد المتابعة",
  },
});

const SERVICE_STATUS_LABELS = Object.freeze({
  service: {
    created: "طلب جديد",
    accepted: "مقبول",
    assigned: "معيّن لك",
    scheduled: "مجدول",
    in_transit: "في الطريق",
    in_progress: "قيد التنفيذ",
    completed: "مكتمل",
    cancelled: "ملغى",
    unknown: "قيد المتابعة",
  },
});

const TRANSPORT_STATUS_LABELS = Object.freeze({
  transport: {
    created: "طلب نقل جديد",
    accepted: "مقبول",
    assigned: "معيّن لك",
    scheduled: "مجدول",
    picked_up: "تم استلام الشحنة",
    in_transit: "في الطريق",
    in_progress: "قيد التنفيذ",
    completed: "مكتمل",
    cancelled: "ملغى",
    unknown: "قيد المتابعة",
  },
});

const ROLE_STATUS_LABELS = Object.freeze({
  customer: CUSTOMER_STATUS_LABELS,
  merchant: MERCHANT_STATUS_LABELS,
  driver: DRIVER_STATUS_LABELS,
  service: SERVICE_STATUS_LABELS,
  transport: TRANSPORT_STATUS_LABELS,
  admin: CUSTOMER_STATUS_LABELS,
});

function labelFromMap(map, workflow, statusUnified) {
  const wf = map && map[workflow] ? workflow : "unknown";
  const st = String(statusUnified || UNIFIED_STATUS.UNKNOWN);
  const row = (map && map[wf]) || (map && map.unknown) || {};
  return row[st] || row.unknown || st || "—";
}

/**
 * ترجمة العرض حسب الدور — ليست مصدر المنطق التشغيلي.
 * @param {string} role customer|merchant|driver|service|transport|admin
 * @param {string} workflow
 * @param {string} statusUnified
 */
function statusLabelForRole(role, workflow, statusUnified) {
  const r = String(role || "customer").trim().toLowerCase();
  const maps = ROLE_STATUS_LABELS[r] || ROLE_STATUS_LABELS.customer;
  if (maps[workflow]) return labelFromMap(maps, workflow, statusUnified);
  return labelFromMap(CUSTOMER_STATUS_LABELS, workflow, statusUnified);
}

function customerStatusLabel(workflow, statusUnified) {
  return statusLabelForRole("customer", workflow, statusUnified);
}

function workflowTypeLabel(order, workflow) {
  const wf = workflow || resolveCustomerOrderWorkflow(order);
  const ot = String((order && order.order_type) || "").trim().toLowerCase();
  if (wf === WORKFLOW.STORE) return ot === "restaurant" ? "طلب مطعم" : "طلب متجر";
  if (wf === WORKFLOW.SERVICE) return "طلب خدمة";
  if (wf === WORKFLOW.TRANSPORT) return "طلب نقل";
  if (wf === WORKFLOW.INTERNAL_DELIVERY) return "طلب توصيل داخلي";
  if (wf === WORKFLOW.DELIVERY) return "طلب توصيل";
  return "طلب";
}

/**
 * يضيف حقول القراءة دون حذف أو إعادة تسمية الحقول الأصلية.
 * لا يُدرج النص العربي في JSON — الترجمة في الواجهة عبر statusLabelForRole.
 * @param {object} order
 * @param {string|{role?:string,userId?:string,storeId?:string}|null} [actor]
 * @returns {object}
 */
function projectUnifiedOrderReadModel(order, actor) {
  if (!order || typeof order !== "object") return order;
  const workflow = resolveCustomerOrderWorkflow(order);
  const status_unified = resolveUnifiedOrderStatus(order, workflow);
  const current_actor_type = resolveCurrentActorType(order, workflow);
  const out = {
    ...order,
    workflow,
    status_unified,
    current_actor_type,
    fulfiller_type: current_actor_type,
  };
  if (actor) {
    const { availableActionsForRole } = require("./availableActions");
    out.available_actions = availableActionsForRole(order, actor);
  }
  return out;
}

/** @deprecated اسم المرحلة السابقة — نفس projectUnifiedOrderReadModel */
function projectCustomerOrderReadModel(order) {
  return projectUnifiedOrderReadModel(order);
}

function projectUnifiedOrdersReadModel(orders, actor) {
  return (orders || []).map((row) => projectUnifiedOrderReadModel(row, actor));
}

function projectCustomerOrdersReadModel(orders, actor) {
  return projectUnifiedOrdersReadModel(orders, actor);
}

module.exports = {
  WORKFLOW,
  UNIFIED_STATUS,
  CURRENT_ACTOR_TYPE,
  FULFILLER_TYPE,
  CUSTOMER_STATUS_LABELS,
  ROLE_STATUS_LABELS,
  resolveCustomerOrderWorkflow,
  resolveUnifiedOrderStatus,
  resolveCurrentActorType,
  resolveFulfillerType,
  statusLabelForRole,
  customerStatusLabel,
  workflowTypeLabel,
  projectUnifiedOrderReadModel,
  projectUnifiedOrdersReadModel,
  projectCustomerOrderReadModel,
  projectCustomerOrdersReadModel,
};
