/**
 * عمولة منصة ERVENOW الموحّدة — مصدر واحد للنسبة (افتراضي 7%).
 * يمكن تجاوزها عبر ERVENOW_PLATFORM_COMMISSION_RATE في .env
 */
const PLATFORM_COMMISSION_RATE = (() => {
  const raw =
    process.env.ERVENOW_PLATFORM_COMMISSION_RATE ||
    process.env.ERWENOW_PLATFORM_COMMISSION_RATE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.07;
})();

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function computePlatformCommission(totalAmount) {
  return roundMoney((Number(totalAmount) || 0) * PLATFORM_COMMISSION_RATE);
}

function commissionPercentLabel() {
  return Math.round(PLATFORM_COMMISSION_RATE * 100) + "%";
}

module.exports = {
  PLATFORM_COMMISSION_RATE,
  computePlatformCommission,
  commissionPercentLabel,
  roundMoney,
};
