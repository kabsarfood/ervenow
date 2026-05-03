/**
 * رابط API على Railway للواجهة المنفصلة (Vercel).
 * استبدل YOUR-PROJECT بالنطاق الحقيقي لمشروعك، مثل: my-app.up.railway.app
 *
 * بديل: ضع ERVENOW_PUBLIC_API_BASE في ملف .env ثم شغّل npm run frontend:sync
 * (يُكتب الرابط تلقائياً في ervenow-frontend/assets/api-config.js عند وجود المتغير).
 */
(function () {
  if (typeof window === "undefined") return;
  window.__ERVENOW_API_BASE__ = "https://YOUR-PROJECT.up.railway.app";
})();
