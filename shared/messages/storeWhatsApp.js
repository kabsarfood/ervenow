/**
 * رسائل واتساب للتجار بعد موافقة الإدارة على المتجر.
 */

function safeName(name) {
  const n = String(name || "").trim();
  if (!n || n.length > 80) return "";
  return n;
}

function publicBaseUrl() {
  return String(process.env.ERVENOW_PUBLIC_URL || process.env.ERWENOW_PUBLIC_URL || "").replace(/\/$/, "");
}

/** بعد موافقة الإدارة — رابط لوحة التحكم الخاصة بالمتجر */
function facilityWord(storeType) {
  return String(storeType || "").toLowerCase() === "restaurant" ? "مطعمك" : "متجرك";
}

function storeApprovedBody(storeName, options) {
  const who = safeName(storeName);
  const arWho = who ? `${who} — ` : "";
  const base = publicBaseUrl();
  const word = facilityWord(options && options.type);
  const panel = base ? `${base}/merchant-preview#complete` : "/merchant-preview#complete";
  const login = base ? `${base}/login?role=store` : "/login?role=store";
  return (
    `ERVENOW\n\n` +
    `${arWho}تم اعتماد ${word} في ERVENOW. أكمل صفحة منشأتك لتظهر للعملاء.\n\n` +
    `أكمل الصفحة من هنا:\n${panel}\n\n` +
    `سجّل الدخول كـ «تاجر» بنفس رقم الجوال:\n${login}`
  );
}

function storeNeedsInfoBody(storeName, message, options) {
  const who = safeName(storeName);
  const arWho = who ? `${who} — ` : "";
  const word = facilityWord(options && options.type);
  const base = publicBaseUrl();
  const form = base ? `${base}/register-store` : "/register-store";
  const note = String(message || "").trim();
  return (
    `ERVENOW\n\n` +
    `${arWho}طلب انضمام ${word} يحتاج استكمال بيانات.\n\n` +
    (note ? `المطلوب:\n${note}\n\n` : "") +
    `عد إلى نفس الطلب وأكمل البيانات ثم أعد الإرسال:\n${form}`
  );
}

module.exports = {
  storeApprovedBody,
  storeNeedsInfoBody,
  facilityWord,
};
