# ERVENOW — مراجعة نقاط Login وRegister

**النوع:** تحليل فقط — لا تنفيذ.  
**التاريخ:** 2026-09-22  
**المصدر:** `public/` · `server/server.js` · `apps/core/routes.js` · `apps/driver/routes.js` · `apps/store/routes.js` · `apps/admin/auth.js` · `public/login.html` · `public/assets/guest-shell.js` · `public/assets/mobile-foundation.js`

لم يُغيَّر أي كود.

---

## الخلاصة

البوابة العامة الحية للدخول هي **`/login`** (نفس الملف مع أو بدون `?role=`).

إنشاء العضوية **ليس** كله داخل `/login`:

- عميل / مندوب / مزود خدمة / نقل → نموذج «إنشاء عضوية» في `/login` (بدون OTP) ثم موافقة.
- متجر → صفحة مستقلة **`/register-store`**.
- مندوب (مسار ثانٍ) → **`/driver-register`** بلا OTP.
- إدارة → **`/admin-login`** منفصل (OTP إداري).

`/driver-login` و`/service-provider-login` و`/delivery/login` **ليست** صفحات دخول بعد: 302 أو `location.replace` إلى `/login?role=…`.

**الهدف المعماري ممكن، لكنه غير مكتمل اليوم.** أكبر فجوة: تسجيل المتجر، و`/driver-register`، وروابط البوابات التي ما زالت تكتب `/driver-login`. تدفقك المطلوب (OTP أولاً ثم اختيار نوع الانضمام) يختلف عن التدفق الحالي (دخول بـ OTP / تسجيل بلا OTP).

---

## 1–2. صفحات Login وRegister

| الصفحة | Login؟ | Register؟ | Role | API | حالة |
|---|---|---|---|---|---|
| `/login` و`/login?role=customer\|driver\|store\|service` | نعم (تبويب دخول الأعضاء) | نعم (تبويب إنشاء عضوية) ما عدا المتجر يُحوَّل | تلميح UI فقط؛ الحساب الموجود يُقرأ من DB | `POST /api/core/send-otp` · `verify-otp` (`login_only`) · `register-account` / `register` | **حية — البوابة العامة** |
| `/admin-login` | نعم | لا | admin فقط | `POST /api/admin/auth/send-otp` · `verify-otp` | **حية — معزولة** |
| `/driver-login` | لا (غلاف) | لا | driver hint | لا OTP | **Legacy Redirect** 302 → `/login?role=driver` |
| `/service-provider-login` | لا (غلاف) | لا | service hint | لا OTP | **Legacy Redirect** 302 → `/login?role=service` |
| `/delivery/login` | لا (غلاف) | لا | driver hint | لا OTP | **Legacy** HTML `location.replace` → `/login?role=driver` (لا route Express خاص) |
| `/register-store` | لا | نعم — طلب متجر كامل | store/merchant/restaurant | `POST /api/store/register` | **حية — خارج `/login`** |
| `/driver-register` | لا | نعم — طلب مندوب | driver | `POST /api/driver/register` (بدون OTP) | **حية ومكررة** مع تبويب المندوب في `/login` |
| `/partner-portal` | لا | لا — قائمة روابط | store + service | لا | **حية — موزّع** |
| `/pending-approval.html` | لا | لا — بعد الطلب | أي دور قيد المراجعة | لا | حية |
| `/pre-registered.html` | لا | لا — شكر pre-reg | — | لا | حية إذا `verify-otp` أعاد `pre_registration` |
| `/customer-preview` | لا | لا | — | — | 302 `/` (متقاعد) |

لا توجد صفحة `signup.html`. Transport ليس Role DB؛ يُسجَّل كـ `service` + `service_type`.

`/login?role=admin` من `login.html` يُحوَّل فوراً إلى `/admin-login`.

---

## 3. Routes التي تبدأ OTP أو إنشاء حساب

### OTP دخول (جلسة)

| المسار | من يستدعيه حياً | نطاق OTP |
|---|---|---|
| `POST /api/core/send-otp` + `verify-otp` | `/login` فقط | `CORE_LOGIN` |
| `POST /api/admin/auth/send-otp` + `verify-otp` | `/admin-login` فقط | إدارة |
| `POST /api/driver/send-otp` + `verify-otp` | **لا صفحة حية** | `DRIVER_LOGIN` + جدول `drivers` — API باقٍ |

`login_only: true` على `/api/core/verify-otp`: إن لم يوجد صف في `users` → `not_registered` (403). لا يُنشأ حساب من تبويب الدخول.

OTP المحفظة (`/api/wallet/withdraw/send-otp`) ليس دخول عضوية.

### إنشاء حساب (بدون جلسة فورية)

| المسار | الصفحة | ماذا ينشئ |
|---|---|---|
| `POST /api/core/register-account` و`/api/core/register` | `/login` إنشاء عضوية | صف `users` (و`drivers` إن كان مندوب) — `pending_approval: true` |
| `POST /api/store/register` | `/register-store` | طلب متجر |
| `POST /api/driver/register` | `/driver-register` وأيضاً مسار قديم داخل `/login` بعد verify | صف `drivers` pending |

`verify-otp` **بدون** `login_only` ما زال قادراً على إنشاء/تحديث مستخدم؛ واجهة التسجيل الحالية تفضّل `register-account` بلا رمز.

---

## 4 و10. الأزرار والملاحة الحية

### هيدر / شريط سفلي / رئيسية → بوابة عامة

| المكان | النص | الوجهة |
|---|---|---|
| `/` قائمة سريعة | الدخول | `/login` |
| `/` قائمة سريعة | إنشاء عضوية | `/login?mode=register&role=customer` |
| `/` هيدر CTA | دخول | `/login?role=customer` |
| Bottom nav «حسابي» | — | `/login?role=customer` |
| guest-shell «دخول الأعضاء» | — | `/login?role=customer` |
| صفحات الأقسام (مطاعم، متاجر، خدمات…) | دخول الأعضاء | `/login?role=customer` |
| السلة / checkout / الخريطة | تسجيل / دخول | `/login?role=customer` أو `mode=register` |

هذه **ليست** بوابات مختلفة؛ كلها نفس `/login.html` مع تلميح عميل.

### «انضم» / تسجيل شريك — خارج `/login` أو عبر Redirect

| المكان | الوجهة |
|---|---|
| `/` بطاقة «سجّل متجرك» + فوتر | `/register-store` |
| `/` فوتر «تسجيل مندوب» | `/driver-register` |
| اختيار متجر داخل `/login` إنشاء عضوية | `location.replace("/register-store")` |
| بوابات شريك غير مسجّل | `/driver-login` أو `/service-provider-login` أو `/login?role=store` |

### روابط ما زالت تكتب صفحات Legacy (تعمل بسبب 302)

- `driver-preview.html` · `driver-preview.js` · `driver-nav.js` · `driver-app.html` · `driver.html` · `orders.html` · `driver-register.html` → `/driver-login`
- `service-preview.html` · `transport-preview.html` · `partner-portal.html` → `/service-provider-login`
- `portal-shell.js`: `driver: "/driver-login"` و`service/transport: "/service-provider-login"` · `admin: "/login?role=admin"` (ثم تحويل إلى `/admin-login`)

لا iframe دخول. `mobile-preview` معمل أجهزة فقط.

«ابدأ الآن» على الرئيسية/الأقسام يذهب إلى `/` (طلب) لا إلى Login.

---

## 6. ماذا تستطيع `/login` اليوم؟

| القدرة | الجواب |
|---|---|
| دخول Customer موجود | نعم — OTP + `login_only` |
| إنشاء Customer جديد | نعم — تبويب إنشاء عضوية بلا OTP → pending ثم دخول لاحق بـ OTP |
| دخول Merchant موجود | نعم — نفس OTP؛ الدور من DB لا من `?role=` |
| دخول Driver موجود | نعم — نفس القاعدة |
| دخول Service Provider موجود | نعم — نفس القاعدة |
| دخول Transport موجود | نعم — `service` + `service_type` ثم `/transport-preview` |
| دخول Admin | لا — يُرفض من `/api/core/send-otp` ويُطلب `/admin-login` |
| إنشاء متجر داخل نفس النموذج | لا — تحويل إلى `/register-store` |

مندوب يفتح `/login?role=customer` ثم يوثّق: الجلسة `driver` والوجهة `/driver-preview`.

---

## 7. أين تُنشأ العضوية لكل Role؟

| Role | أين فعلياً |
|---|---|
| Customer | `/login?mode=register` → `POST /api/core/register-account` |
| Merchant | **`/register-store` → `POST /api/store/register`** (المسار الرسمي). الـAPI العام يسمح بـ `store` لكن الواجهة لا تكمل التسجيل داخل `/login` |
| Driver | **مساران:** (1) `/login` إنشاء عضوية → `register-account` + صف `drivers` (2) **`/driver-register` → `/api/driver/register` بلا OTP** |
| Service Provider | `/login?mode=register&role=service` → `register-account` مع `service_type` |
| Transport Provider | نفس مسار Service مع نوع نقل (`pickup_truck` / `furniture_move` / `internal_delivery`) |
| Admin | لا تسجيل ذاتي. يُنشأ في DB + قائمة هواتف البيئة ثم `/admin-login` |

بعد أي `register-account`: الواجهة تذهب إلى `/pending-approval.html`. الدخول الفعلي لاحقاً من `/login` بـ OTP.

---

## 8. Roles ما زالت خارج `/login` بالكامل؟

- **Admin:** صفحة وAPI منفصلان — مطلوب إبقاؤهما.
- **Merchant إنشاء:** صفحة كاملة خارج `/login`.
- **Driver إنشاء (النسخة القديمة):** `/driver-register` ما زالت تُخدم وتظهر في فوتر الرئيسية.
- **دخول** كل الأدوار التشغيلية غير الإدارة: داخل `/login` بعد OTP.

---

## 9. APIs قديمة

- `/api/driver/send-otp` و`/api/driver/verify-otp`: **موجودان في السيرفر**. لا تستدعيهما أي صفحة HTML حية. جلسة مختلفة (`DRIVER_LOGIN` + جدول `drivers`).
- `/api/driver/register`: **حي** من `/driver-register` ومن بقايا مسار `/login` بعد verify.
- `/api/admin/auth/*`: حي لـ `/admin-login` فقط.
- `auth-otp-flow.js`: مساعد UI لزر الإرسال/التحقق على `/login` و`/admin-login` — ليس API قديماً.

---

## ازدواجية

1. دخول المندوب/الخدمة: URLs قديمة حية في البوابات رغم 302.
2. تسجيل المندوب: `/login` و`/driver-register`.
3. تسجيل المتجر: ليس خياراً داخل نموذج `/login` بل صفحة ثانية.
4. `partner-portal`: صفحة ثالثة لاختيار المتجر/الخدمة.
5. تدفق التسجيل الحالي بلا OTP ≠ الهدف (OTP ثم اختيار النوع).

---

## التوصية المعمارية (بدون تنفيذ)

**نعم: اعتمد `/login` بوابة عامة واحدة للدخول وإنشاء العضوية غير الإدارية.**

أبقِ **`/admin-login` فقط** للإدارة.

الشروط حتى يطابق الهدف:

1. OTP واحد (`/api/core/*`) لكل غير-admin: موجود → Role Routing؛ غير موجود → اختيار النوع (عميل / متجر / مندوب / مزود خدمة) ثم استكمال البيانات.
2. إبقاء `/register-store` كخطوة **نماذج متجر بعد الاختيار**، لا كبوابة دخول مستقلة — أو دمج حدّها الأدنى داخل `/login`.
3. إيقاف `/driver-register` كواجهة (Redirect إلى `/login?mode=register&role=driver`) بعد التأكد أن نموذج `/login` يغطي الحقول.
4. تحويل الروابط الحية من `/driver-login` و`/service-provider-login` إلى `/login?role=…` في البوابات و`portal-shell.js` (الـ302 يبقى شبكة أمان).
5. لا تستخدم `/api/driver/send-otp` في الواجهة؛ احذفه أو أغلقه لاحقاً بعد التأكد ألا يعتمد عليه تطبيق خارجي.
6. لا تخلط OTP المحفظة مع عضوية.

ما لا يجب دمجه: `/admin-login`، دورة الطلبات، Wallet، Tracking.
