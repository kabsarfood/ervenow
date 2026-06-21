/**
 * تأجيل نشر طلبات الخدمة لمزوّدي الخدمة حتى تأكيد الدفع.
 * تلميع المركبات وخدمات السعر الثابت: دائماً بعد الدفع.
 * خدمات المعاينة: تُنشر قبل الدفع عند payment_mode = on_service | after_diagnosis.
 */
const { isOrderPaymentGateRequired } = require("./orderPaymentGate");

const PREPAID_SERVICE_TYPES = new Set(["car_polishing", "cleaning_villa", "cleaning_building"]);

function deferServiceProviderDispatch(serviceType, paymentStatus, payloadData) {
  if (String(paymentStatus || "").toLowerCase() === "paid") return false;
  const st = String(serviceType || "").toLowerCase();
  if (PREPAID_SERVICE_TYPES.has(st)) return true;
  const mode = String((payloadData && payloadData.payment_mode) || "").toLowerCase();
  if (["on_service", "after_diagnosis", "cash_on_delivery"].includes(mode)) return false;
  return isOrderPaymentGateRequired();
}

function isPrepaidServiceType(serviceType) {
  return PREPAID_SERVICE_TYPES.has(String(serviceType || "").toLowerCase());
}

module.exports = {
  PREPAID_SERVICE_TYPES,
  deferServiceProviderDispatch,
  isPrepaidServiceType,
};
