const { DELIVERY_STATUS } = require("./constants");

/**
 * الحالة التشغيلية الفعّالة للعرض والمنطق (بدون كسر التوافق مع الصفوف القديمة).
 * يُفضّل قراءة delivery_status أولاً ثم الاحتياط إلى status للقيم القديمة فقط حيث ينطبق.
 */
function getEffectiveDeliveryStatus(row) {
  if (!row || typeof row !== "object") return null;
  const ds = row.delivery_status != null ? String(row.delivery_status).trim().toLowerCase() : "";
  if (ds) return ds;
  const st = row.status != null ? String(row.status).trim().toLowerCase() : "";
  if (st === DELIVERY_STATUS.NEW || st === DELIVERY_STATUS.PENDING) return st;
  return st || null;
}

function isTerminalDeliveryStatus(s) {
  const x = String(s || "").toLowerCase();
  return x === DELIVERY_STATUS.DELIVERED || x === DELIVERY_STATUS.CANCELLED || x === DELIVERY_STATUS.CANCELLED_BY_CUSTOMER;
}

module.exports = { getEffectiveDeliveryStatus, isTerminalDeliveryStatus };
