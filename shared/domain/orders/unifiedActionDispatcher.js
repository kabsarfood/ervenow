/**
 * Unified Action Dispatcher — واجهة أوامر فوق المحرك الحالي.
 * لا يكتب انتقالًا جديدًا:
 * start_preparing → PATCH delivery_status=preparing
 * mark_ready → PATCH delivery_status=ready
 */

const { DELIVERY_STATUS } = require("./constants");
const { WORKFLOW, UNIFIED_STATUS, projectUnifiedOrderReadModel } = require("./unifiedReadModel");
const {
  ACTION,
  availableActionsForRole,
  actorFromAppUser,
  normalizeRole,
} = require("./availableActions");
const { merchantOwnsOrder, patchUnifiedOrderStatus } = require("../../services/unifiedOrderStatus");
const { getOrderDeliveryStatus } = require("./orderStatus");

const SUPPORTED_ACTIONS = Object.freeze({
  [ACTION.START_PREPARING]: Object.freeze({
    delivery_status: DELIVERY_STATUS.PREPARING,
    requireRole: "merchant",
    requireWorkflow: WORKFLOW.STORE,
    requireStatusUnified: UNIFIED_STATUS.ACCEPTED,
  }),
  [ACTION.MARK_READY]: Object.freeze({
    delivery_status: DELIVERY_STATUS.READY,
    requireRole: "merchant",
    requireWorkflow: WORKFLOW.STORE,
    requireStatusUnified: UNIFIED_STATUS.PREPARING,
  }),
});

function failResult(status, error, extra) {
  return Object.assign({ ok: false, status, error }, extra || {});
}

function merchantActor(appUser, order) {
  return actorFromAppUser(appUser, {
    role: "merchant",
    storeId: order && order.store_id ? order.store_id : null,
  });
}

async function loadOrder(sb, orderId) {
  const { data, error } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) return { order: null, error };
  return { order: data || null, error: null };
}

/**
 * @param {object} sb
 * @param {string} orderId
 * @param {string} actionRaw
 * @param {object} appUser
 * @param {{ patchUnifiedOrderStatus?: Function, merchantOwnsOrder?: Function }} [deps]
 */
async function dispatchUnifiedOrderAction(sb, orderId, actionRaw, appUser, deps) {
  const patchFn = (deps && deps.patchUnifiedOrderStatus) || patchUnifiedOrderStatus;
  const ownsFn = (deps && deps.merchantOwnsOrder) || merchantOwnsOrder;

  const id = String(orderId || "").trim();
  const action = String(actionRaw || "")
    .trim()
    .toLowerCase();
  if (!id) return failResult(400, "id required");
  if (!action) return failResult(400, "action required");

  const spec = SUPPORTED_ACTIONS[action];
  if (!spec) return failResult(400, "unsupported action");

  const { order, error: loadErr } = await loadOrder(sb, id);
  if (loadErr) return failResult(400, loadErr.message || String(loadErr));
  if (!order) return failResult(404, "Not found");

  const previous_status = getOrderDeliveryStatus(order);
  const projectedBefore = projectUnifiedOrderReadModel(order, merchantActor(appUser, order));
  const role = normalizeRole(appUser && appUser.role);

  if (role !== spec.requireRole) {
    return failResult(403, "Forbidden", { action, order_id: id });
  }

  const owns = await ownsFn(sb, order, appUser);
  if (!owns) {
    return failResult(403, "Forbidden", { action, order_id: id });
  }

  if (projectedBefore.workflow !== spec.requireWorkflow) {
    return failResult(409, "action not available for this workflow", {
      action,
      order_id: id,
      workflow: projectedBefore.workflow,
    });
  }

  if (projectedBefore.status_unified !== spec.requireStatusUnified) {
    return failResult(409, "action not available", {
      action,
      order_id: id,
      status_unified: projectedBefore.status_unified,
    });
  }

  const allowed = Array.isArray(projectedBefore.available_actions) ? projectedBefore.available_actions : [];
  if (allowed.indexOf(action) === -1) {
    return failResult(409, "action not available", {
      action,
      order_id: id,
      available_actions: allowed,
    });
  }

  const out = await patchFn(sb, id, spec.delivery_status, appUser);
  if (out && out.error) {
    const msg = out.error.message || String(out.error);
    const status = msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 400;
    return failResult(status, msg, { action, order_id: id });
  }

  const updated = out && out.data ? out.data : { ...order, delivery_status: spec.delivery_status };
  const projected = projectUnifiedOrderReadModel(updated, merchantActor(appUser, updated));

  return {
    ok: true,
    status: 200,
    action,
    order_id: projected.id || id,
    workflow: projected.workflow,
    previous_status,
    previous_status_unified: projectedBefore.status_unified,
    status_unified: projected.status_unified,
    current_actor_type: projected.current_actor_type,
    available_actions: projected.available_actions || [],
    order: projected,
  };
}

module.exports = {
  SUPPORTED_ACTIONS,
  dispatchUnifiedOrderAction,
};
