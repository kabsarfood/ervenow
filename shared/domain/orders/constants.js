/**
 * ثوابت دورة التوصيل على جدول orders.delivery_status
 * (لا تغيّر القيم دون تحديث الواجهات وهجرات CHECK).
 */

/** حالات دورة التوصيل المعروفة في الكود */
const DELIVERY_STATUS = Object.freeze({
  DRAFT: "draft",
  NEW: "new",
  PENDING: "pending",
  ACCEPTED: "accepted",
  PREPARING: "preparing",
  READY: "ready",
  PICKED: "picked",
  PICKED_UP: "picked_up",
  DELIVERING: "delivering",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  CANCELLED_BY_CUSTOMER: "cancelled_by_customer",
});

/** حالات المسار المالي التقليدي على orders.status (انظر apps/finance) */
const FINANCE_ORDER_STATUS = Object.freeze({
  NEW: "new",
  ACCEPTED: "accepted",
  ONROAD: "onroad",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
});

module.exports = { DELIVERY_STATUS, FINANCE_ORDER_STATUS };
