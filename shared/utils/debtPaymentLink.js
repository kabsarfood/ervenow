/**
 * رابط سداد الديون — Pay Link (بدون سلة / بدون محفظة فقط).
 */

function getPublicSiteBase() {
  return String(process.env.ERVENOW_PUBLIC_URL || "https://ervenow.com").replace(/\/$/, "");
}

function roundAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * @param {string} userId
 * @param {number|string} amount
 */
function buildDebtPaymentLink(userId, amount) {
  const uid = String(userId || "").trim();
  const amt = roundAmount(amount);
  const base = getPublicSiteBase();
  return `${base}/pay?uid=${encodeURIComponent(uid)}&amount=${encodeURIComponent(amt)}&type=debt`;
}

/**
 * @param {number|string} amount
 * @param {string} paymentLink
 */
function buildDebtWarningMessage(amount, paymentLink) {
  const amt = roundAmount(amount);
  return (
    `أهلاً بكم في منصة ارفينو 🌟\n\n` +
    `نود إشعاركم بوجود مستحقات مالية على حسابكم بقيمة (${amt} ريال).\n\n` +
    `نأمل منكم تسديدها في أقرب وقت ممكن، تجنباً لأي إيقاف مؤقت للخدمات.\n\n` +
    `يمكنكم السداد بسهولة عبر الرابط التالي:\n` +
    `${paymentLink}\n\n` +
    `نشكر تعاونكم 🙏`
  );
}

/**
 * @param {number|string} amount
 * @param {string} paymentLink
 */
function buildDebtBlockMessage(amount, paymentLink) {
  const amt = roundAmount(amount);
  return (
    `أهلاً بكم في منصة ارفينو\n\n` +
    `نود إشعاركم بوجود مستحقات مالية غير مسددة على حسابكم بقيمة (${amt} ريال).\n\n` +
    `تم إيقاف حسابكم مؤقتاً لحين السداد.\n\n` +
    `يمكنكم إعادة تفعيل الحساب عبر الرابط التالي:\n` +
    `${paymentLink}\n\n` +
    `نشكر تفهمكم 🌟`
  );
}

/**
 * @param {number|string} amountPaid
 * @param {number|string} balanceRemaining
 */
function buildDebtUnfreezeMessage(amountPaid, balanceRemaining) {
  const paid = roundAmount(amountPaid);
  const rem = roundAmount(balanceRemaining);
  return (
    `أهلاً بكم في منصة ارفينو 🌟\n\n` +
    `تم استلام سدادكم بقيمة (${paid} ريال) بنجاح.\n\n` +
    `تم إعادة تفعيل حسابكم.` +
    (Number(rem) > 0 ? `\n\nالمتبقي على حسابكم: (${rem} ريال).` : "") +
    `\n\nنشكركم 🙏`
  );
}

/**
 * @param {"warn"|"block"|"unfreeze"} kind
 */
function buildDebtNotifyMessage(kind, amount, paymentLink) {
  if (kind === "block") return buildDebtBlockMessage(amount, paymentLink);
  if (kind === "unfreeze") return buildDebtUnfreezeMessage(amount, paymentLink || 0);
  return buildDebtWarningMessage(amount, paymentLink);
}

module.exports = {
  getPublicSiteBase,
  buildDebtPaymentLink,
  buildDebtWarningMessage,
  buildDebtBlockMessage,
  buildDebtUnfreezeMessage,
  buildDebtNotifyMessage,
  roundAmount,
};
