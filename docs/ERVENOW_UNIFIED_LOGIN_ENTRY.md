# توحيد بوابة الدخول العامة `/login`

تاريخ: 21 سبتمبر 2026

لم يُغيَّر: WhatsApp OTP · TTL · Session · جدول users · تصنيف الأدوار · وجهات Post-login في `ErvenowRoleRouting`.
لم تُمس دورة الطلبات.

---

## 1. صفحات Login الحالية

| المسار | الحالة |
|---|---|
| `/login` | البوابة العامة |
| `/admin-login` | مستقل (إدارة) |
| `/driver-login` | Legacy Redirect → `/login?role=driver` |
| `/service-provider-login` | Legacy Redirect → `/login?role=service` |
| `/delivery/login` | Legacy Redirect → `/login?role=driver` |

ليست صفحات دخول: `/register-store` · `/driver-register` (تسجيل).

---

## 2. ما الذي كان مختلفًا

- `/login`: OTP عبر `/api/core/send-otp` + `/api/core/verify-otp` (`login_only`).
- `/driver-login`: OTP منفصل `/api/driver/send-otp` و`verify-otp` (نطاق `DRIVER_LOGIN` + جدول `drivers`). **لم يُحذف الـAPI**؛ الصفحة لم تعد تستدعيه.
- `/service-provider-login`: نفس OTP الأساسي لكن يرفض أي دور غير `service`.
- `/login?role=driver|service` كان يحوّل إلى الصفحات القديمة — عُكس ذلك.

لا توجد وظيفة OTP فريدة في الصفحات القديمة غير موجودة في `/login` بعد التوحيد، عدا فحص جدول `drivers` في مسار المندوب القديم. المندوب الموجود في `users` يدخل من البوابة العامة.

---

## 3. ما نُقل إلى `/login`

- دخول Customer / Merchant / Driver / Service / Transport hint من بوابة واحدة.
- `role` في الرابط = تلميح UI/تسجيل فقط. الحساب الموجود يُقرأ من قاعدة المستخدمين.
- بعد النجاح: `ErvenowRoleRouting` + `login-destinations.default` بدون سؤال عن الدور.
- مستخدم جديد بعد OTP (`not_registered`) → وضع التسجيل بأربعة خيارات.
- اختيار المتجر يفتح `/register-store`.
- Transport ليس Role DB؛ يبقى `service` + `service_type`.

---

## 4. Legacy Redirect

- `/driver-login` و`/service-provider-login`: 302 من الخادم + HTML احتياطي.
- `/delivery/login`: إلى `/login?role=driver`.
- `/admin-login` بقي مستقلًا ويوجّه بعد النجاح عبر Role Routing إلى `/admin-dashboard`.

---

## 5. الاختبارات

وحدة `unifiedLoginEntry.test.js`: نجحت.

حي محلي:

- `/driver-login` → 302 `/login?role=driver`
- `/driver-login?next=/driver-preview` يحافظ على `next`
- `/service-provider-login` → 302 `/login?role=service`
- `/login?role=driver` → 200 صفحة `/login` (لا ارتداد)
- `/admin-login` → 200 مستقل

وجهات الحساب (من المحرك المركزي):

- Customer → `/`
- Merchant/store → `/merchant-preview`
- Driver → `/driver-preview`
- Service (plumber…) → `/service-preview`
- Transport (`pickup_truck`…) → `/transport-preview`
- Admin → `/admin-dashboard`

OTP واتساب الحي لكل دور يحتاج رمزًا على الجوال ولم يُنفَّذ هنا.

---

## 6. رابط Role خاطئ لحساب موجود

مندوب يفتح `/login?role=customer` ثم يوثّق OTP:

- الخادم يثبّت الجلسة على دوره المخزَّن (`driver`) وليس تلميح الرابط.
- التوجيه إلى `/driver-preview`.

نفس القاعدة للتاجر ومزود الخدمة.
