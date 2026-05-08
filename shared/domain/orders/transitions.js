const { isValidDeliveryTransition } = require("../../utils/helpers");
const { isAllowedDeliveryStatusTransition } = require("../../utils/deliveryStateMachine");

/**
 * هل انتقال delivery_status مسموح؟ (يُفضّل استدعاؤه من طبقة التطبيق قبل UPDATE)
 */
function canTransitionDeliveryStatus(from, to) {
  return isAllowedDeliveryStatusTransition(from, to);
}

/** للاستخدامات التي تعتمد helpers.isValidDeliveryTransition مباشرة (توافق) */
function canTransitionDeliveryStatusLegacy(from, to) {
  return isValidDeliveryTransition(from, to);
}

module.exports = { canTransitionDeliveryStatus, canTransitionDeliveryStatusLegacy };
