const { DELIVERY_STATUS, FINANCE_ORDER_STATUS } = require("./constants");
const { getEffectiveDeliveryStatus, isTerminalDeliveryStatus } = require("./effectiveStatus");
const { canTransitionDeliveryStatus, canTransitionDeliveryStatusLegacy } = require("./transitions");
const {
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
  buildOrderStatusPatch,
  isTerminalOrderStatus,
} = require("./orderStatus");
const {
  WORKFLOW,
  UNIFIED_STATUS,
  CURRENT_ACTOR_TYPE,
  FULFILLER_TYPE,
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
} = require("./unifiedReadModel");
const { ACTION, availableActionsForRole, actorFromAppUser } = require("./availableActions");
const { dispatchUnifiedOrderAction } = require("./unifiedActionDispatcher");

module.exports = {
  DELIVERY_STATUS,
  FINANCE_ORDER_STATUS,
  getEffectiveDeliveryStatus,
  getOrderDeliveryStatus,
  normalizeIncomingStatus,
  buildOrderStatusPatch,
  isTerminalOrderStatus,
  isTerminalDeliveryStatus,
  canTransitionDeliveryStatus,
  canTransitionDeliveryStatusLegacy,
  WORKFLOW,
  UNIFIED_STATUS,
  CURRENT_ACTOR_TYPE,
  FULFILLER_TYPE,
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
  ACTION,
  availableActionsForRole,
  actorFromAppUser,
  dispatchUnifiedOrderAction,
};
