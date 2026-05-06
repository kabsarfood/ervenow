/**
 * عند التعطيل (الافتراضي): الطلبات تُنشأ بـ payment_status=pending وتُنشر للمناديب دون بوابة دفع.
 * عند ERVENOW_REQUIRE_ORDER_PAYMENT=1: يُشترط تأكيد الدفع في الجسم (paid / payment_status) ليصبح الطلب pending وللإيداع في محفظة المتجر.
 */
function isOrderPaymentGateRequired() {
  return String(process.env.ERVENOW_REQUIRE_ORDER_PAYMENT || "").trim() === "1";
}

module.exports = { isOrderPaymentGateRequired };
