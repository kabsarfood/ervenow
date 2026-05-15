/** عمولة المنصة على service_bookings — نفس نسبة المنصة الموحّدة */
const {
  PLATFORM_COMMISSION_RATE,
  computePlatformCommission,
  commissionPercentLabel,
} = require("./platformCommission");

function commissionRateForServiceType(_serviceType) {
  return PLATFORM_COMMISSION_RATE;
}

function computeServiceCommission(totalAmount, _serviceType) {
  return computePlatformCommission(totalAmount);
}

module.exports = {
  PLATFORM_COMMISSION_RATE,
  computePlatformCommission: computeServiceCommission,
  commissionRateForServiceType,
  commissionPercentLabel,
};
