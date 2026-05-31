/**
 * رسائل واتساب للمندوبين (عربي + إنجليزي في رسالة واحدة).
 */

function safeName(name) {
  const n = String(name || "").trim();
  if (!n || n.length > 80) return "";
  return n;
}

/** بعد إرسال نموذج التسجيل — بانتظار موافقة الإدارة */
function driverPendingRegistrationBody(displayName) {
  const who = safeName(displayName);
  const arWho = who ? `${who}، ` : "";
  const enWho = who ? `${who}, ` : "";
  return (
    `ERVENOW Delivery\n\n` +
    `${arWho}أهلاً بكم في منصة ارفينو دلفري. تم استلام طلب التسجيل — حسابك قيد المراجعة من إدارة ERVENOW.\n\n` +
    `${enWho}Welcome to Ervenow Delivery — your registration was received and is under review by ERVENOW.`
  );
}

/** بعد موافقة الإدارة على الحساب */
function driverApprovedBody(displayName) {
  const who = safeName(displayName);
  const arWho = who ? `${who}، ` : "";
  const enWho = who ? `${who}, ` : "";
  return (
    `ERVENOW Delivery\n\n` +
    `${arWho}تمت الموافقة على تسجيلكم في منصة ارفينو دلفري. نتمنى لكم عملاً دائماً بحفظ الرحمن.\n\n` +
    `${enWho}Your registration on Ervenow Delivery has been approved. We wish you lasting work and success — under God's protection and care.`
  );
}

module.exports = {
  driverPendingRegistrationBody,
  driverApprovedBody,
};
