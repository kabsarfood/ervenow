# ERVENOW — بوابة عضوية OTP-First عبر `/login`

**التاريخ:** 2026-09-22  
**النوع:** تنفيذ.  
**لم يُمس:** `/admin-login` · وجهات ما بعد الدخول · دورة الطلبات · Wallet.

---

## الخلاصة

`/login` هي بوابة الدخول وإنشاء العضوية العامة الوحيدة.

الاستثناء الوحيد: `/admin-login` يبقى مستقلًا للإدارة، ولا يظهر Admin في خيارات التسجيل.

القاعدة الجديدة: **لا إنشاء عضوية عامة قبل توثيق رقم الجوال.**

OTP → سياق تسجيل موثّق (JWT `purpose=ervenow_register` لمدة 30 دقيقة) → اختيار الدور → استكمال النموذج → إنشاء الحساب.

---

## 1. الملفات المعدّلة

**خادم**

- `shared/utils/registrationContext.js` — توقيع/تحقق سياق التسجيل
- `apps/core/routes.js` — verify-otp موجود vs `needs_registration`؛ `register-account` يتطلب السياق
- `apps/store/routes.js` — `POST /api/store/register` يتطلب السياق
- `apps/driver/routes.js` — `POST /api/driver/register` يتطلب السياق
- `server/server.js` — 302 لـ `/driver-register` قبل static
- `shared/middleware/publicSiteOtpGate.js` — السماح لصفحات التسجيل/الدخول القديمة
- `shared/messages/accountApprovalWhatsApp.js` — روابط الدخول الموحّدة

**واجهة `public/` (+ مرآة `ervenow-frontend/`)**

- `login.html` — OTP أولاً ثم شاشة «كيف تريد استخدام ERVENOW؟»
- `register-store.html` — خطوة تالية بعد السياق الموثّق
- `driver-register.html` — غلاف تحويل إلى `/login`
- `partner-portal.html` — صفحة تعريفية بأزرار `/login?mode=register&role=…`
- `index.html` — CTA المتجر/المندوب إلى البوابة الموحّدة
- `assets/portal-framework/portal-shell.js`
- `assets/portal-framework/role-context.js`
- `assets/driver-preview.js` · `assets/driver-nav.js`
- `driver-preview.html` · `service-preview.html` · `transport-preview.html`
- `orders.html` · `driver.html` · `driver-wallet.html` · `driver-app.html`

**اختبارات / نشر**

- `tests/unit/loginOtpFirst.test.js`
- `scripts/sync-ervenow-frontend.js` و`ervenow-frontend/vercel.json` — 302 لـ `/driver-register`

---

## 2. رحلة التسجيل الجديدة لكل Role

### مستخدم موجود

`/login` → جوال → OTP → الحساب موجود → قراءة Role من قاعدة البيانات → البوابة الرسمية.  
بدون سؤال عن نوع الحساب.

### مستخدم جديد

`/login` → جوال → OTP ناجح → لا حساب → شاشة:

**كيف تريد استخدام ERVENOW؟**

- عميل
- متجر
- مندوب
- مزود خدمة

Transport ليس Role مستقلة. يُختار لاحقًا من `service_type` داخل مزود الخدمة (سطحة / أثاث / توصيل داخلي).

### Customer

اختيار عميل → `POST /api/core/register-account` مع `registration_token` → حساب `active` → `/`

### Merchant

اختيار متجر → `/register-store` مع نفس السياق الموثّق في `sessionStorage` → نموذج المتجر الحالي بدون OTP ثانٍ → `POST /api/store/register`

### Driver

اختيار مندوب → نموذج المندوب داخل `/login` → `register-account` (وليس `/driver-register` ولا `/api/driver/send-otp`) → قيد المراجعة

### Service Provider

اختيار مزود خدمة → `service_type` → البيانات المطلوبة → `register-account` → قيد المراجعة  
Transport = service + نوع نقل.

---

## 3. ماذا أصبح `/register-store`

لم يعد بوابة تسجيل مستقلة.

هو **الخطوة التالية بعد OTP الموثّق**.

- زيارة مباشرة بدون `ervenow_registration_token` → تحويل الواجهة إلى `/login?mode=register&role=store`
- الإرسال يمرّر `registration_token`
- الخادم يرفض الطلب بدون سياق OTP (403 `REGISTRATION_CONTEXT_REQUIRED`)
- رقم الجوال يُؤخذ من التوكن الموثّق ولا يُعاد توثيقه

روابط الرئيسية «سجّل متجرك» تشير إلى `/login?mode=register&role=store`.

---

## 4. ماذا حدث لـ `/driver-register`

أُلغي كواجهة تسجيل.

- الخادم: 302 `/login?mode=register&role=driver` (قبل static)
- HTML احتياطي: `location.replace` لنفس المسار
- الواجهة الجديدة لا تستدعي `/api/driver/send-otp`
- `/api/driver/register` بقي مغلفًا بالسياق الموثّق فقط (احتياط للمسارات القديمة)

---

## 5. هل بقي أي Register عام يمكن الوصول إليه بدون OTP؟

لا كمسار إنشاء فعّال.

| المسار | بدون OTP |
|---|---|
| `/login` إنشاء عضوية | لا — OTP أولاً |
| `/register-store` | النموذج يظهر فقط بعد السياق؛ API يرفض بدونه |
| `/driver-register` | 302 إلى `/login` |
| `/partner-portal` | تعريفي فقط؛ الأزرار إلى `/login?mode=register&role=…` |
| `POST /api/core/register-account` | 403 بدون توكن |
| `POST /api/store/register` | 403 بدون توكن |
| `POST /api/driver/register` | 403 بدون توكن |
| `register_without_otp` | 403 |
| `/admin-login` | مستقل — ليس تسجيلًا عامًا |

`/api/driver/send-otp` ما زال موجودًا في الخادم ولم يُحذف؛ لا صفحة حية تستدعيه.

---

## 6. Partner Portal وLegacy URLs

`/partner-portal` ليست بوابة تسجيل ثالثة.

- متجر → `/login?mode=register&role=store`
- مندوب → `/login?mode=register&role=driver`
- مزود خدمة → `/login?mode=register&role=service`

روابط حية من `/driver-login` و`/service-provider-login` في البوابات و`portal-shell` صارت:

- `/login?role=driver`
- `/login?role=service`

الـ302 القديمة بقيت للتوافق.

---

## 7. وجهات ما بعد الدخول (لم تُغيَّر)

- Customer → `/`
- Merchant → `/merchant-preview`
- Driver → `/driver-preview`
- Service → `/service-preview`
- Transport → `/transport-preview`
- Admin → `/admin-dashboard` عبر `/admin-login` فقط

---

## 8. نتيجة الاختبارات

وحدة `tests/unit/loginOtpFirst.test.js` + `unifiedLoginEntry` + `adminAuthIsolation` + `resolvePortalRole` + `b2cLegacyRoutes`: **36 نجحت**.

حي على `127.0.0.1:4000` بعد إعادة التشغيل:

1. Customer موجود → OTP → token + role customer → `/` (وحدة)
2. Merchant موجود → OTP → `/merchant-preview` (وحدة)
3. Driver موجود → OTP → `/driver-preview` (وحدة)
4. Service موجود → OTP → `/service-preview` (وحدة)
5. رقم جديد → OTP → `needs_registration` + `registration_token` بدون إنشاء مستخدم؛ إنشاء عميل بالتوكن → `/` (وحدة)
6. `/register-store` يتطلب السياق ويمرّر التوكن (واجهة + 403 API)
7. تسجيل المندوب من `/login` بدون `/api/driver/send-otp` وبدون صفحة موازية
8. شاشة أربعة أدوار؛ Transport = `service_type` داخل مزود الخدمة
9. `GET /driver-register` حي → **302** `/login?mode=register&role=driver`
10. حي: Store / Driver / register-account بدون سياق → **403** `REGISTRATION_CONTEXT_REQUIRED`

OTP واتساب الحي لحسابات حقيقية يحتاج رقم جوال ولم يُنفَّذ هنا كرحلة يدوية كاملة.

`/admin-login` بقي 200 مستقلًا.
