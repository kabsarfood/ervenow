/**
 * صافي التاجر على بضاعة المتجر — نفس منطق العمولة الموحّدة (7% افتراضي).
 */
const { computePlatformCommission, roundMoney } = require("./platformCommission");

function storeMerchantNetFromOrder(order) {
  const goods = Number(order?.order_total) || 0;
  if (!(goods > 0)) return 0;
  return roundMoney(goods - computePlatformCommission(goods));
}

function storeMerchantLedgerRef(orderId) {
  return `order:${String(orderId || "").trim()}:merchant_net`;
}

function legacyCheckoutMerchantRef(orderId) {
  return `store:order:${String(orderId || "").trim()}:merchant_net`;
}

module.exports = {
  storeMerchantNetFromOrder,
  storeMerchantLedgerRef,
  legacyCheckoutMerchantRef,
};
