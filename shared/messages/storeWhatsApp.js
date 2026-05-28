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
function storeApprovedBody(storeName) {
  const who = safeName(storeName);
  const arWho = who ? `${who} — ` : "";
  const base = publicBaseUrl();
  const panel = base ? `${base}/store-dashboard` : "/store-dashboard";
  const login = base ? `${base}/login?role=merchant` : "/login?role=merchant";
  return (
    `ERVENOW\n\n` +
    `${arWho}تمت الموافقة على متجرك في المنصة.\n\n` +
    `صفحة التحكم الخاصة بمتجرك (شعار، صور، أسعار، عروض):\n${panel}\n\n` +
    `سجّل الدخول كـ «تاجر» بنفس رقم الجوال:\n${login}`
  );
}

module.exports = {
  storeApprovedBody,
};
