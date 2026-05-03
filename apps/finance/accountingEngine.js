/**
 * ERVENOW — Accounting Engine (منطق العمولات والتسوية)
 * الرصيد الفعلي يُحدَّث فقط عبر wallet_transactions + مشغّل قاعدة البيانات.
 */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * جلب نسب العمولة النشطة حسب البلد (مع احتياط 12%).
 */
async function fetchCommissionRates(supabase, countryCode = "SA") {
  const { data, error } = await supabase
    .from("commission_rules")
    .select("applies_to, commission_rate, country_code")
    .eq("is_active", true)
    .or(`country_code.eq.${countryCode},country_code.is.null`);

  if (error) throw error;

  const rates = { merchant: 0.12, delivery: 0.12, service: 0.12 };
  for (const row of data || []) {
    if (row.applies_to && row.commission_rate != null) {
      rates[row.applies_to] = Number(row.commission_rate);
    }
  }
  return rates;
}

/**
 * حساب التوزيع حسب المواصفات:
 * - عمولة المنصة من قيمة الطلب (سلعة/خدمة)
 * - عمولة المنصة من أجرة التوصيل
 * - صافي المندوب = delivery_fee - عمولة التوصيل للمنصة
 * - صافي التاجر = order_total - platform_fee - delivery_fee
 * - ضريبة على عمولة المنصة فقط (اختياري عبر platformVatOnCommissionRate)
 *
 * بدون تاجر ولا مقدم خدمة: صافي التاجر يُضاف إلى دخل المنصة.
 */
function calculateCommission({
  orderTotal,
  deliveryFee,
  rateMerchant = 0.12,
  rateDelivery = 0.12,
  merchantId = null,
  serviceProviderId = null,
  platformVatOnCommissionRate = 0,
}) {
  const ot = Number(orderTotal) || 0;
  const df = Number(deliveryFee) || 0;

  const platform_fee = round2(ot * rateMerchant);
  const delivery_platform_fee = round2(df * rateDelivery);
  const driver_net = round2(df - delivery_platform_fee);
  let merchant_net = round2(ot - platform_fee - df);
  if (merchant_net < 0) merchant_net = 0;

  let platform_total = round2(platform_fee + delivery_platform_fee);

  if (!merchantId && !serviceProviderId && merchant_net > 0) {
    platform_total = round2(platform_total + merchant_net);
    merchant_net = 0;
  }

  const platform_vat_on_commission =
    platformVatOnCommissionRate > 0 ? round2(platform_total * Number(platformVatOnCommissionRate)) : 0;

  const breakdown = {
    platform_fee,
    delivery_platform_fee,
    driver_net,
    merchant_net,
    platform_total,
    platform_vat_on_commission,
    commission_rate_merchant: rateMerchant,
    commission_rate_delivery: rateDelivery,
    platform_vat_rate: platformVatOnCommissionRate,
  };

  return {
    platform_fee,
    delivery_platform_fee,
    driver_net,
    merchant_net,
    platform_total,
    platform_vat_on_commission,
    breakdown,
  };
}

/** استدعاء دالة التسوية الذرية في Postgres */
async function distributeFunds(supabase, orderId) {
  const { data, error } = await supabase.rpc("erwenow_finance_settle_order", { p_order_id: orderId });
  if (error) throw error;
  return data;
}

/** استرجاع: عكس التسوية (إن وُجدت) + إيداع لزائر المنصة */
async function handleRefund(supabase, orderId, reason, customerCredit = null) {
  const { data, error } = await supabase.rpc("erwenow_finance_refund_order", {
    p_order_id: orderId,
    p_reason: reason || "استرجاع",
    p_customer_credit: customerCredit,
  });
  if (error) throw error;
  return data;
}

module.exports = {
  round2,
  fetchCommissionRates,
  calculateCommission,
  distributeFunds,
  handleRefund,
};
