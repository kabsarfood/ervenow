/**
 * عند التعطيل (الافتراضي): الطلبات تُنشأ pending وتُنشر للمناديب دون اشتراط دفع — مناسب أثناء التطوير.
 * للإنتاج لاحقاً: عيّن ERVENOW_REQUIRE_ORDER_PAYMENT=1 لتفعيل مسودة draft حتى يُؤكَّد الدفع.
 */
function isOrderPaymentGateRequired() {
  return String(process.env.ERVENOW_REQUIRE_ORDER_PAYMENT || "").trim() === "1";
}

module.exports = { isOrderPaymentGateRequired };
