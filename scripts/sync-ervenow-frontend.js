/**
 * ينسخ محتويات public/ إلى جذر ervenow-frontend/ (بدون مجلد public داخلي) لنشر Vercel.
 * تشغيل: npm run frontend:sync
 *
 * رابط API للواجهة المنفصلة (اختياري):
 *   set ERVENOW_PUBLIC_API_BASE=https://xxx.up.railway.app && npm run frontend:sync
 *
 * أو ضع ERVENOW_PUBLIC_API_BASE في .env (يُحمَّل تلقائياً عبر dotenv).
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

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

/* تأكيد: لا يوجد ervenow-frontend/public/index.html — الجذر يجب أن يحوي index.html مباشرة */
const nestedPublic = path.join(dst, "public");
if (fs.existsSync(nestedPublic)) {
  console.warn("[sync] إزالة مجلد public/ الزائد داخل ervenow-frontend/");
  const inner = fs.readdirSync(nestedPublic);
  for (const name of inner) {
    fs.renameSync(path.join(nestedPublic, name), path.join(dst, name));
  }
  fs.rmSync(nestedPublic, { recursive: true, force: true });
}

if (!fs.existsSync(path.join(dst, "index.html"))) {
  console.error("[sync] فشل: index.html غير موجود في جذر ervenow-frontend/");
  process.exit(1);
}

const apiBaseFromEnv = String(process.env.ERVENOW_PUBLIC_API_BASE || "").trim().replace(/\/$/, "");

const vercelJson = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  cleanUrls: true,
  trailingSlash: false,
  routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index.html" }],
};
fs.writeFileSync(path.join(dst, "vercel.json"), JSON.stringify(vercelJson, null, 2));

if (apiBaseFromEnv) {
  const apiBaseLiteral = JSON.stringify(apiBaseFromEnv);
  const apiConfigContent = `/**
 * نُسِخ من المزامنة — الرابط من ERVENOW_PUBLIC_API_BASE (.env أو البيئة).
 */
(function () {
  if (typeof window === "undefined") return;
  window.__ERVENOW_API_BASE__ = ${apiBaseLiteral};
})();
`;
  fs.writeFileSync(path.join(dst, "assets", "api-config.js"), apiConfigContent, "utf8");
}

const pkg = {
  name: "ervenow-frontend",
  private: true,
  version: "1.0.0",
  description: "ERVENOW static UI — deploy root on Vercel (no nested public/)",
};
fs.writeFileSync(path.join(dst, "package.json"), JSON.stringify(pkg, null, 2));

const deployTxt = `ERVENOW — نشر الواجهة (Vercel) + API (Railway)
================================================

هيكل المجلد (يجب أن يكون الجذر كما يلي، بدون public/ داخلي):
  ervenow-frontend/index.html
  ervenow-frontend/browse.html
  ervenow-frontend/wallet.html
  ervenow-frontend/assets/
  ervenow-frontend/vercel.json

1) المزامنة من المستودع:
   - عدّل public/assets/api-config.js (رابط Railway) ثم: npm run frontend:sync
   - أو ضع في .env: ERVENOW_PUBLIC_API_BASE=https://xxx.up.railway.app ثم npm run frontend:sync
     (يستبدل api-config في ervenow-frontend فقط عند وجود المتغير)

2) Vercel
   - Framework Preset: Other
   - Root Directory: ervenow-frontend  (مهم جداً إن كان المستودع يحتوي backend أيضاً)
   - لا تضع Output إلى مجلد فرعي public/

3) Railway (API)
   - SERVE_STATIC=0
   - CORS_ORIGINS=https://your-project.vercel.app

4) التحقق
   - افتح https://your-project.vercel.app — يجب أن تظهر الصفحة الرئيسية وليس 404
`;

fs.writeFileSync(path.join(dst, "DEPLOY.txt"), deployTxt, "utf8");

console.log("Synced public/* -> ervenow-frontend/ (flat root, vercel.json)");
if (apiBaseFromEnv) {
  console.log("API_BASE (ERVENOW_PUBLIC_API_BASE):", apiBaseFromEnv);
} else {
  console.log("API_BASE: من public/assets/api-config.js — لتجاوزها ضع ERVENOW_PUBLIC_API_BASE في .env ثم أعد المزامنة");
}
