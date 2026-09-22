# ERVENOW — مراجعة دخول الأدمن (تحليل فقط)

**النوع:** فحص معماري — لا تنفيذ.  
**التاريخ:** 2026-09-21  
**النطاق:** `/admin-login` · `/admin-dashboard` · OTP الأساسي · جلسة JWT.  
**خارج النطاق:** `/login` العام · توجيه التاجر/المندوب/الخدمة · دورة الطلبات.

---

## الخلاصة

لوحة الإدارة لها **صفحة دخول مستقلة** (`/admin-login`) لكن **ليست نظام مصادقة مستقلاً**.

التحقق يمر على نفس:

- `POST /api/core/send-otp`
- `POST /api/core/verify-otp`

ثم تُصدر **نفس JWT المنصة** (`signPlatformToken`) و**نفس مفاتيح التخزين** (`token` / `ervenow_access_token` / كوكي `auth_token`).

التحقق الإداري الحقيقي موجود في الخادم:

1. رقم الجوال في قائمة البيئة (allowlist).
2. صف موجود مسبقاً و `users.role = admin`.
3. لا تسجيل ذاتي لدور `admin`.

الفجوة الأهم: **حساب Admin يستطيع الدخول من `/login` العامة** ويُوجَّه إلى `/admin-dashboard` عبر `ErvenowRoleRouting`.

---

## 1. كيف يتم Authentication للأدمن حالياً؟

المسار التشغيلي:

```
/admin-login
  → إرسال OTP: POST /api/core/send-otp  { phone, role: "admin" }
  → تحقق:     POST /api/core/verify-otp { phone, code, role: "admin" }
  → JWT 7 أيام + localStorage + cookie
  → تحويل إلى /admin-dashboard (عبر ErvenowRoleRouting)
```

الملفات:

- الواجهة: `public/admin-login.html` (لا تسجيل · لا اختيار Role).
- المسار: `server/server.js` → `GET /admin-login` يرسل نفس الملف.
- OTP: `apps/core/routes.js`.
- قواعد الدور: `shared/utils/roleAssignment.js` (`canAdminOtpLogin`).
- حراسة اللوحة: `public/admin/modules/settings.js` → `ensureAdminAccess()`.

لا يوجد Password. لا يوجد API أدمن منفصل للدخول.

---

## 2. هل يستخدم نفس send-otp / verify-otp أم API إداري منفصل؟

**نفس الـ API العام.** لا يوجد `/api/admin/send-otp` أو `/api/admin/verify-otp`.

العزل الداخلي الوحيد هو **مفتاح OTP**:

| المصدر | جسم الطلب | مفتاح التخزين |
| --- | --- | --- |
| `/login` | `login_only: true` (بدون role) | `login:<digits>` |
| `/admin-login` | `role: "admin"` (بدون login_only) | `admin:<digits>` |

النطاق واحد: `OTP_SCOPE.CORE_LOGIN`. قناة واتساب واحدة. الرسالة تختلف نصاً (`لوحة الإدارة` vs `تسجيل الدخول`).

---

## 3. كيف يتم التأكد أن المستخدم Admin؟

ثلاث طبقات:

**أ) allowlist أرقام** — `ERVENOW_ADMIN_LOGIN_PHONE` + `ERVENOW_ADMIN_FULL_PHONES` + limited1/2.  
عند `send-otp` إذا `role=admin` والرقم خارج القائمة → `403` «غير مصرح لهذا الرقم بدخول لوحة الإدارة».

**ب) صف قاعدة البيانات** — عند `verify-otp` إذا `role=admin`:

```
canAdminOtpLogin = رقم في القائمة AND existingUser.id AND users.role === "admin"
```

وإلا `403` «لا يمكن ترقية الحساب إلى مدير أو دور حسّاس».  
لا يُنشأ صف admin من الواجهة. التسجيل الذاتي يرفض `admin`. ترقية الأدمن عبر سكربت `scripts/seed-first-admin.js` (بيئة + تأكيد) أو تعديل يدوي في قاعدة البيانات.

**ج) بعد الجلسة** — `requireAuth` يقرأ الدور من DB لا من التوكن فقط.  
`/api/admin/*` بـ `requireRole("admin")`. صلاحيات فرعية حسب رقم الجوال (`full` / `limited1` / `limited2`).

---

## 4. هل يستطيع Admin الدخول من `/login` العامة؟

**نعم — هذا الازدواج الأهم.**

`/login` يرسل `login_only` بدون `role`. الخادم يجد المستخدم الموجود ويصدر الجلسة بدوره المخزّن. إذا كان `users.role=admin` يصدر JWT أدمن ثم `ErvenowRoleRouting` يفتح `/admin-dashboard`.

`/login?role=admin` يحوّل إلى `/admin-login` (bounce في الواجهة فقط).  
الدخول **بدون** `?role=admin` لا يُمنع.

---

## 5. إذا دخل مستخدم عادي إلى `/admin-login` ماذا يحدث؟

| الحالة | النتيجة |
| --- | --- |
| رقم خارج allowlist | إرسال OTP يُرفض فوراً (403) |
| رقم في القائمة لكن الدور ليس admin | OTP قد يُرسل ثم التحقق يُرفض (403 ترقية) |
| جلسة عميل موجودة | الصفحة تبقى ظاهرة (لا تطرد المستخدم بوضوح) |
| لا يوجد اختيار Role / تسجيل | صحيح — الواجهة نظيفة إدارياً |

رسالة الرفض الحالية مضللة («لا يمكن ترقية الحساب…») بدل «هذا الحساب ليس إدارياً».

---

## 6. هل توجد أكثر من صفحة Admin Login أو مسار قديم؟

| المسار | الحالة |
| --- | --- |
| `/admin-login` | الدخول الرسمي |
| `public/admin-login.html` + مرآة `ervenow-frontend/` | نفس الملف |
| `/login?role=admin` | تحويل واجهة إلى `/admin-login` |
| `/admin/` → `public/admin/index.html` | صدفة iframe قديمة بدون حراسة؛ تحمّل `/admin-dashboard` |
| `/dashboard` | لوحة عامة قديمة؛ تنبيه أدمن مع رابط `/admin` |
| صفحات HTML إدارية متفرقة | `/admin-settings` · `/admin/branding` · `/admin/categories` … ليست دخول |

لا صفحة password ثانية. لا `/admin/login`.

---

## 7. هل يوجد Password أو OTP أو Emergency login قديم؟

- **لا Password** لدخول الأدمن.
- **OTP واتساب فقط** (5 دقائق).
- `ALLOW_DEV_OTP` ما زال موجوداً في الإعداد العام، لكن `isDevOtpBypassCode()` يعيد `false` دائماً — رمز التطوير 1977 **معطّل في الكود**.
- لا Emergency login منفصل.
- زرع أول أدمن: سكربت بيئة محلي فقط، ليس مسار ويب.

---

## 8. كيف تُنشأ جلسة الأدمن؟

بعد verify ناجح:

1. `signPlatformToken(userId, phone, role)` — JWT 7 أيام، نفس سر المنصة.
2. `attachSiteSessionCookie`.
3. الواجهة تخزّن `token` + `ervenow_access_token` + كوكي `auth_token`.

ليست جلسة إدارية منفصلة. نفس مخزن العميل/الشريك. من يملك توكن أدمن يستطيع استدعاء APIs العامة أيضاً (حسب الدور).

---

## 9. كيف تتم حماية `/admin-dashboard`؟

**الصفحة HTML غير محمية على السيرفر.** أي زائر يحمّل الملف.

الحماية:

1. JS: `ensureAdminAccess()` يستدعي `/api/core/me` — إن لم يكن `role=admin` يحوّل إلى `/admin-login`.
2. البيانات: `/api/admin/*` = `requireAuth` + `requireRole("admin")` (+ أحياناً `requireAdminPermission`).
3. `requireAuth` يثبّت الدور من صف `users`.

النتيجة: الغلاف يظهر لحظة ثم يُطرد غير الأدمن. لا تُسرَّب بيانات اللوحة عبر API إن فشلت المصادقة.

---

## 10. هل يوجد اعتماد على ErvenowRoleRouting يسبب ازدواجية؟

**نعم في الواجهة بعد النجاح.**

`admin-login.html` يستدعي `ErvenowRoleRouting.resolvePostLoginPath`. اليوم المسار الناتج هو `/admin-dashboard`، لكن المحرّك **عام** (عميل/تاجر/مندوب/خدمة/أدمن). أي تغيير مستقبلي في التوجيه العام قد يحرّك الأدمن إلى بوابة خاطئة.

كذلك `/login` العامة تستخدم نفس المحرّك؛ لذلك أدمن ناجح من الدخول العام يصل للكونسول دون المرور بـ `/admin-login`.

---

## أين الازدواجية؟

1. **نفس OTP API** لعملاء المنصة وللإدارة (مع مفتاح subject مختلف).
2. **نفس JWT / نفس localStorage** — لا فصل جلسة.
3. **Admin يستطيع `/login` العام** → كونسول الإدارة.
4. **بعد النجاح يعتمد RoleRouting العام** بدل مسار إداري ثابت.
5. **صدفة `/admin/index.html`** قديمة بدون auth.
6. **send-otp للأدمن يفحص الرقم فقط** لا الدور — قد يُرسل رمز لرقم مصرّح ليس admin.

ما هو سليم أصلاً:

- الواجهة `/admin-login` بلا تسجيل وبلا Role picker.
- الخادم لا يرقّي أحداً إلى admin من الطلب.
- APIs اللوحة تتطلب `role=admin` من قاعدة البيانات.

---

## التوصية (قبل التنفيذ)

**لا نحتاج مزوّد OTP جديداً ولا Twilio منفصلاً.**  
قناة واتساب المشتركة آمنة إذا بقي التحقق الإداري صارماً.

**نحتاج مسار تحقق أدمن مستقل في الـ API** (ولو غلّف نفس خدمة OTP داخلياً)، حتى لا يستطيع `login_only` العام إصدار جلسة `admin`.

الخيار المفضّل:

```
Public Auth  → /login            → /api/core/send-otp + verify-otp (login_only)
Admin Auth   → /admin-login      → /api/admin/send-otp + verify-otp
                 (داخلياً: نفس otpChallengeService + مفتاح admin:<digits>)
```

بديل أخف (إن رُفض endpoint جديد): الإبقاء على `/api/core/*` مع قواعد:

- إن `users.role=admin` على `/login` → رفض واضح: استخدم `/admin-login` (لا تصدر توكن).
- على مسار الأدمن: فحص **الدور + القائمة قبل إرسال OTP**.
- بعد نجاح الأدمن: تحويل ثابت `/admin-dashboard` بدون RoleRouting.
- رسالة رفض واضحة لغير الأدمن.

لا تغيير على تسجيل العملاء/الشركاء ولا دورة الطلبات.

---

## المخاطر إن بقي الوضع كما هو

| خطر | الأثر |
| --- | --- |
| أدمن يدخل من `/login` | مسار التحقق والصلاحية ليسا مستقلين كما طُلب |
| توكن واحد لكل الأدوار | جلسة أدمن تعمل كجلسة منصة عامة |
| HTML اللوحة عام | الغلاف مرئي قبل الطرد (البيانات محمية) |
| RoleRouting بعد دخول الأدمن | ازدواجية توجيه مستقبلية |
| رسالة 403 مضللة | مستخدم عادي لا يفهم الرفض |
| OTP يُرسل لرقم allowlist غير admin | تسريب رمز بدون جلسة |

---

## قرار مطلوب منك

أ) Endpoint أدمن منفصل يغلف نفس خدمة OTP (موصى به).  
ب) نفس `/api/core/*` مع رفض أدمن على `/login` + تحقق أدمن أصرم + مسار ثابت بعد الدخول.

بعد اختيار أ أو ب ننفّذ دون المساس بنظام المستخدمين العام.
