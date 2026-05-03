/**
 * ينسخ public/ إلى ervenow-frontend/ جاهزًا لنشر Vercel (مجلد الجذر = ملفات الواجهة).
 * تشغيل: npm run frontend:sync
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "public");
const dst = path.join(root, "ervenow-frontend");

if (!fs.existsSync(src)) {
  console.error("missing public/");
  process.exit(1);
}

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(src, dst, { recursive: true });

const vercelJson = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  cleanUrls: true,
  trailingSlash: false,
};
fs.writeFileSync(path.join(dst, "vercel.json"), JSON.stringify(vercelJson, null, 2));

const deployTxt = `ERVENOW — نشر الواجهة (Vercel) + API (Railway)
================================================

1) Railway (API فقط)
   - SERVE_STATIC=0
   - NODE_ENV=production
   - CORS_ORIGINS=https://your-app.vercel.app,http://localhost:3000
     (بدون مسافات بعد الفاصلة؛ أضف كل نطاقات الواجهة)

2) المفتاح في الواجهة
   عدّل الملف: assets/api-config.js
   ضع رابط Railway الكامل بدون شرطة أخيرة، مثال:
   window.__ERVENOW_API_BASE__ = "https://xxxx.up.railway.app";

   أو عرّف meta في أي صفحة:
   <meta name="ervenow-api-base" content="https://xxxx.up.railway.app" />

3) Vercel
   - أنشئ مشروعًا من مجلد ervenow-frontend (هذا المجلد بعد المزامنة)
   - Framework: Other / Static
   - تحقق: GET https://your-api.../api/health

4) Worker (خدمة ثانية على Railway)
   - Start Command: npm run worker:delivery
   - نفس المتغيرات + REDIS_URL من Redis Railway

مزامنة المحتوى من المستودع:
   npm run frontend:sync
`;

fs.writeFileSync(path.join(dst, "DEPLOY.txt"), deployTxt, "utf8");

console.log("Synced public/ -> ervenow-frontend/ (+ vercel.json, DEPLOY.txt)");
