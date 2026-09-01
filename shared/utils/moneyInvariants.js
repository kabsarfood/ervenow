/**
 * ثوابت مالية Closed Alpha — لا إنشاء/اختفاء مال على مستوى الطلب.
 */

const { computePlatformCommission, roundMoney } = require("./platformCommission");

/**
 * Customer payment ≈ merchant_net + driver_earning + platform_revenue (+ vat already in payment).
 * EW PAY store: goods + delivery + VAT.
 */
function splitDeliveredOrder(order) {
  const goods = roundMoney(Number(order?.order_total) || 0);
  const delivery = roundMoney(Number(order?.delivery_fee) || 0);
  const vat = roundMoney(Number(order?.vat_amount) || 0);
  const paid = roundMoney(
    Number(order?.total_with_vat) > 0
      ? Number(order.total_with_vat)
      : Number(order?.total_amount) || goods + delivery + vat
  );
  const platformOnGoods = computePlatformCommission(goods);
  const merchantNet = roundMoney(Math.max(0, goods - platformOnGoods));
  const driverEarning = roundMoney(
    Number(order?.driver_earning) > 0 ? Number(order.driver_earning) : delivery
  );
  const platformOnDelivery = roundMoney(Math.max(0, delivery - driverEarning > 0.009 ? delivery - driverEarning : 0));
  const platformFee = roundMoney(
    Number(order?.platform_fee) > 0 ? Number(order.platform_fee) : platformOnGoods + platformOnDelivery
  );
  const reconstructed = roundMoney(merchantNet + driverEarning + platformFee + vat);
  return {
    paid,
    goods,
    delivery,
    vat,
    merchantNet,
    driverEarning,
    platformFee,
    reconstructed,
    balanced: Math.abs(paid - reconstructed) <= 0.05 || Math.abs(paid - (goods + delivery + vat)) <= 0.05,
  };
}

function assertNoNegativeMoney(split) {
  const keys = ["paid", "goods", "delivery", "vat", "merchantNet", "driverEarning", "platformFee"];
  for (const k of keys) {
    if (Number(split[k]) < -0.001) return false;
  }
  return true;
}

module.exports = {
  splitDeliveredOrder,
  assertNoNegativeMoney,
  roundMoney,
};
