# ERVENOW — Admin Authentication Isolation

**النوع:** تنفيذ  
**التاريخ:** 2026-09-22  
**المهمة:** فصل دخول الإدارة عن `/login` العام مع إعادة استخدام خدمة WhatsApp OTP الحالية.

---

## ما تغيّر

مساران منفصلان:

```
Public  /login        → POST /api/core/send-otp
                      → POST /api/core/verify-otp

Admin   /admin-login  → POST /api/admin/auth/send-otp
                      → POST /api/admin/auth/verify-otp
                      → /admin-dashboard
```

لا مزوّد OTP جديد. نفس:

- توليد الرمز (5 أرقام)
- واتساب `sendOTP`
- TTL 5 دقائق
- تطبيع الجوال
- `sendOtpLimiter`
- `otpChallengeService` (نطاق جديد `admin_login`)

---

## مسارات Admin Auth الجديدة

| Method | Path | حماية |
| --- | --- | --- |
| POST | `/api/admin/auth/send-otp` | غير مصدّق — يفحص allowlist + `users.role=admin` قبل الإرسال |
| POST | `/api/admin/auth/verify-otp` | غير مصدّق — يعيد فحص الدور والقائمة بعد OTP ثم يصدر JWT |

الملف: `apps/admin/auth.js`  
التركيب: `server/server.js` → `app.use("/api/admin/auth", adminAuthRoutes)` قبل `/api/admin`.

`/api/admin/*` الأخرى ما زالت `requireAuth` + `requireRole("admin")`.

---

## هل أُعيد استخدام نفس OTP service؟

نعم. `startOtpChallenge` / `verifyOtpChallenge` / `invalidateOtpChallenge`.

الفرق الوحيد: النطاق `OTP_SCOPE.ADMIN_LOGIN = "admin_login"` ومفتاح `admin:<digits>` حتى لا يختلط برمز `/login` (`core_login` + `login:<digits>`).

---

## كيف مُنع Admin من `/login`

في `apps/core/routes.js`:

- `send-otp`: إذا `role=admin` أو المستخدم الموجود `users.role=admin` → **لا يُرسل OTP** ويرجع `403` مع `code: "ADMIN_LOGIN_REQUIRED"`.
- `verify-otp`: نفس الفحص **قبل** استهلاك الرمز، ولا تُصدر جلسة.
- حزام أمان أخير: إن ظهر الدور admin بعد upsert يُرفض أيضاً.

الواجهة `/login` تعرض:

«هذا حساب إداري. يرجى استخدام بوابة الإدارة.»

مع رابط `/admin-login`.

---

## كيف يُرفض غير الأدمن قبل إرسال OTP

`POST /api/admin/auth/send-otp` يتحقق بالترتيب:

1. رقم سعودي صالح.
2. الرقم في allowlist (`ERVENOW_ADMIN_LOGIN_PHONE` + FULL/LIMITED).
3. حساب موجود.
4. `users.role = admin`.

إن فشل أي شرط: **لا واتساب، لا جلسة، لا تحويل إلى `/login`**.  
الرسالة الوحيدة: «هذا الرقم غير مصرح له بالدخول إلى لوحة الإدارة.»  
لا رسالة «ترقية».

بعد OTP يعيد `verify-otp` نفس الفحص ثم يصدر الجلسة.

---

## الجلسة

نفس بنية JWT الحالية (`sub` · `phone` · `role` · صلاحية 7 أيام).

أُضيف claim اختياري غير إلزامي في هذه المرحلة:

`auth_context: "admin"`

يصدر فقط من Admin Auth.  
`requireRole("admin")` ما زال يعتمد على دور قاعدة البيانات، لا على هذا الـ claim. يمكن تفعيله لاحقاً دون كسر الجلسات الحالية.

---

## الواجهة

`/admin-login`

- بلا تسجيل / Role picker / بوابات شركاء.
- بعد النجاح: `location.replace("/admin-dashboard")` مباشرة (بدون `ErvenowRoleRouting`).
- جلسة Admin موجودة → الداشبورد.
- جلسة عميل/تاجر/مندوب/خدمة → تبقى في صفحة الدخول الإدارية ولا تُعتبر جلسة إدارة.

`/admin-dashboard`

- غلاف تحقق فوري: بدون توكن → `/admin-login`.
- المحتوى مخفي حتى يؤكد `/api/core/me` أن الدور admin.
- خروج: يمسح localStorage والكوكي ويعود `/admin-login`.

---

## المسارات الإدارية القديمة

الملف `public/admin/index.html` **لم يُحذف**.

`GET /admin` و `/admin/` و `/admin/index.html` → **302** إلى `/admin-dashboard` (قبل static)، فيدخل نفس الحارس.

---

## الاختبارات

`tests/unit/adminAuthIsolation.test.js` — 11 اختبارات ناجحة:

1. Admin send+verify → JWT `role=admin` + `auth_context=admin` + redirect `/admin-dashboard`
2. Customer على admin send-otp → 403 قبل واتساب
3. Merchant/store على admin send-otp → 403 قبل واتساب
4. Admin على `/api/core/send-otp` → `ADMIN_LOGIN_REQUIRED` بلا OTP
5. Admin على `/api/core/verify-otp` → بلا توكن
6. `role=admin` على Core API → رفض
7. Customer على Core send-otp → ما زال يعمل
8. HTML: admin-login يستخدم `/api/admin/auth/*` فقط
9. HTML: `/login` يعرض رابط `/admin-login`
10. الداشبورد يخفي الكونسول حتى التحقق
11. `/admin/index.html` محفوظ مع تحويل 302

لم يُغيَّر: دورة الطلبات · Unified Orders · Wallet · دخول الشركاء · Role Routing للشركاء · جداول المستخدمين.

---

## الملفات المعدّلة / الجديدة

جديدة:

- `apps/admin/auth.js`
- `shared/utils/adminOtpAllowlist.js`
- `shared/utils/adminAuthMessages.js`
- `tests/unit/adminAuthIsolation.test.js`
- `docs/ERVENOW_ADMIN_AUTH_ISOLATION.md`

معدّلة:

- `apps/core/routes.js` — حظر أدمن على OTP العام
- `server/server.js` — تركيب المسارات + تحويل `/admin`
- `shared/services/otpChallengeService.js` — نطاق `ADMIN_LOGIN`
- `public/admin-login.html`
- `public/login.html`
- `public/assets/api.js`
- `public/admin/admin-dashboard.html`
- `public/admin/modules/settings.js`
- `public/admin/modules/shared.js`
