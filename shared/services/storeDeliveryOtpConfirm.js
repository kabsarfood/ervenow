/**
 * ERVENOW DELIVERY ENGINE 1.0 — تأكيد استلام العميل (توصيل المتجر) → delivered + Settlement الحالي.
 */

const crypto = require("crypto");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { getOrderDeliveryStatus, buildOrderStatusPatch, isTerminalOrderStatus } = require("../domain/orders/orderStatus");
const { isValidDeliveryTransition } = require("../utils/helpers");
const { updateOrdersResilient } = require("../utils/idempotency");
const { runDeliveredFinancialSettlement } = require("./deliveredFinancialSettlement");
const { afterStatusSideEffects } = require("./unifiedOrderStatus");

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code).trim()).digest("hex");
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function confirmStoreDeliveryReceipt(sb, orderId, appUser, rawCode) {
  const id = String(orderId || "").trim();
  const code = String(rawCode || "").trim();
  if (!id || !/^\d{6}$/.test(code)) {
    return { ok: false, message: "رمز التأكيد (6 أرقام) مطلوب", status: 400 };
  }
  if (!appUser?.id) return { ok: false, message: "يجب تسجيل الدخول", status: 401 };

  const { data: order, error: gErr } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (gErr || !order) return { ok: false, message: "الطلب غير موجود", status: 404 };

  if (order.customer_id && order.customer_id !== appUser.id) {
    return { ok: false, message: "غير مصرح", status: 403 };
  }

  const b = order.breakdown && typeof order.breakdown === "object" ? order.breakdown : {};
  if (b.fulfillment !== "store_delivery" && b.delivery_provider !== "store") {
    return { ok: false, message: "هذا الطلب لا يستخدم تأكيد استلام المتجر", status: 400 };
  }

  const current = getOrderDeliveryStatus(order);
  if (isTerminalOrderStatus(current)) {
    return { ok: true, order, already: true, settlement: null };
  }

  const next = DELIVERY_STATUS.DELIVERED;
  if (!isValidDeliveryTransition(current, next)) {
    return { ok: false, message: `لا يمكن التأكيد من الحالة: ${current}`, status: 400 };
  }

  const { data: otpRow, error: oErr } = await sb
    .from("order_receipt_otps")
    .select("id,code_hash,expires_at,verified_at")
    .eq("order_id", id)
    .is("verified_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (oErr && /order_receipt_otps|schema cache/i.test(String(oErr.message || ""))) {
    return { ok: false, message: "نفّذ migration_delivery_engine_1.sql", status: 400 };
  }
  if (!otpRow) return { ok: false, message: "لا يوجد رمز تأكيد نشط — اطلب من المتجر إرسال الرمز", status: 400 };

  if (otpRow.expires_at && new Date(otpRow.expires_at).getTime() < Date.now()) {
    return { ok: false, message: "انتهت صلاحية الرمز", status: 400 };
  }

  if (hashOtp(code) !== otpRow.code_hash) {
    return { ok: false, message: "الرمز غير صحيح", status: 400 };
  }

  await sb.from("order_receipt_otps").update({ verified_at: new Date().toISOString() }).eq("id", otpRow.id);

  const patch = buildOrderStatusPatch(next);
  const { data: updated, error: uErr } = await updateOrdersResilient(sb, patch, { id });
  if (uErr) return { ok: false, message: uErr.message || "تعذر تحديث الطلب", status: 400 };

  const financial = await runDeliveredFinancialSettlement(sb, updated, "store_otp:delivered");
  await afterStatusSideEffects(sb, updated, current, next, financial);

  return {
    ok: true,
    order: updated,
    settlement: financial.settlement,
    provider_credit: financial.provider_credit,
    driver_credit: financial.driver_credit,
  };
}

module.exports = { confirmStoreDeliveryReceipt, hashOtp };
