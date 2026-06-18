/**
 * نشر الطلب للمناديب/مزودي الخدمة بعد تأكيد الدفع (مثلاً EW PAY).
 * عند ERVENOW_REQUIRE_ORDER_PAYMENT=1 تُنشأ طلبات الخدمة كـ draft حتى الدفع.
 */
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { afterStatusSideEffects } = require("./unifiedOrderStatus");
const { logger } = require("../utils/logger");

async function publishDraftOrderAfterPayment(sb, order) {
  if (!sb || !order?.id) return { published: false, reason: "missing" };

  const current = String(order.delivery_status || "").trim().toLowerCase();
  if (current !== DELIVERY_STATUS.DRAFT) return { published: false, reason: "not_draft" };

  const pay = String(order.payment_status || "").trim().toLowerCase();
  if (pay !== "paid") return { published: false, reason: "not_paid" };

  const { data: updated, error } = await sb
    .from("orders")
    .update({
      delivery_status: DELIVERY_STATUS.PENDING,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("delivery_status", DELIVERY_STATUS.DRAFT)
    .select("*")
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message, orderId: order.id }, "[publishOrderAfterPayment] update");
    return { published: false, reason: "db_error" };
  }
  if (!updated) return { published: false, reason: "already_published" };

  try {
    await afterStatusSideEffects(sb, updated, DELIVERY_STATUS.DRAFT, DELIVERY_STATUS.PENDING, {});
  } catch (sideErr) {
    logger.error(
      { err: sideErr && (sideErr.message || String(sideErr)), orderId: order.id },
      "[publishOrderAfterPayment] side effects"
    );
  }

  return { published: true, order: updated };
}

module.exports = { publishDraftOrderAfterPayment };
