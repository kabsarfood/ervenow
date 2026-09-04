# ERVENOW — Deployment

## 1. المتطلبات

- **Node.js** ≥ 20 (`package.json` engines).
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **JWT:** `ERVENOW_JWT_SECRET` (16+ حرفاً للإنتاج).
- **البيانات البنكية المشفّرة:** `BANK_DATA_SECRET` (16+ حرفاً) في الإنتاج — انظر `server/utils/crypto.js`.
- **Redis (إلزامي للإنتاج مع العامل):** `REDIS_URL` — **Redis ≥ 5.0** (BullMQ لا يعمل على Redis 3.x Windows القديم). استخدم Railway Redis أو Upstash أو Memurai Developer.
- **التواصل:** Twilio لـ OTP واتساب حسب المسارات.

## 2. تشغيل الخادم

```bash
npm install
npm start
```

المنفذ الافتراضي: `PORT` أو **4000**.

## 3. عامل التوصيل (Worker)

```bash
npm run worker:delivery
```

يتطلب `REDIS_URL` — لا يعمل العامل بدونه (انظر `workers/deliveryWorker.js`).

**تطوير Windows (Redis ≥ 5):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-local-redis.ps1
npm run worker:delivery
```

ثم تحقق: `node scripts/final-launch-closure.mjs`

## 4. OTP في الإنتاج

1. نفّذ `shared/migration_ervenow_otp_challenges.sql` و`shared/migration_prelaunch_otp_consumed.sql` في Supabase.
2. عيّن:
   - `ERVENOW_OTP_BACKEND=supabase` (هذا هو الافتراضي الآن؛ `memory` مرفوض في الإنتاج إلا مع `ERVENOW_OTP_ALLOW_MEMORY=1`)
   - `ERVENOW_OTP_PEPPER` — سلسلة سرية طويلة (مستقلة عن JWT؛ 32+ حرفاً موصى به)
   - اختياري: `ERVENOW_OTP_RESEND_COOLDOWN_MS` (افتراضي 45000)، `ERVENOW_OTP_LOCK_MS` (افتراضي 300000)
   - `PUBLIC_ORDERING_ENABLED=false` لحملة التسجيل المسبق
   - `SOCKET_IO_SINGLE_INSTANCE_REQUIRED=true`

الوضع `ERVENOW_OTP_BACKEND=memory` مسموح في Jest فقط (`tests/jest.otp-memory.env.js`).

## 5. Audit

- نفّذ `shared/migration_ervenow_audit_events.sql` قبل تفعيل استدعاءات `auditLog.js` في المسارات.

## 6. الواجهة الثابتة

- `SERVE_STATIC=1` أو وجود `public/index.html` مع `HIDE_PUBLIC_UI` غير مفعّل.
- مزامنة الواجهة: `npm run frontend:sync` عند الحاجة.

## 7. CORS

- عيّن `ERVENOW_PUBLIC_URL` و/أو `CORS_ORIGINS` في الإنتاج (انظر `server/server.js`).

## 8. Rollback

- إصدارات قابلة للتراجع: احتفظ بنسخ `.env` وقائمة هجرات مطبّقة لكل بيئة.
- عند المشاكل مع OTP الجدول: لا تعُد إلى `memory` في الإنتاج. أصلح الهجرة/`ERVENOW_OTP_PEPPER` وأعد التشغيل.
