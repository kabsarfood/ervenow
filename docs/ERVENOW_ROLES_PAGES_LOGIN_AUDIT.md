# ERVENOW — تدقيق الأدوار · الصفحات · مسارات الدخول

**النوع:** تحليل فقط — لا حذف ولا دمج ولا تعديل كود.  
**التاريخ:** 2026-09-21  
**المصدر:** `public/` · `server/server.js` · `shared/utils/portalLaunch.js` · `shared/utils/resolvePortalRole.js` · `shared/utils/loginDestinations.js` · `public/assets/account-destinations.js` · `public/assets/role-routing.js` · `public/assets/platform-access.js` · صفحات الدخول والحراسة في الواجهة.  
**نسخة الواجهة الموازية:** `ervenow-frontend/` مرآة لـ `public/` عبر `npm run frontend:sync` — الجداول تشير إلى `public/` كمصدر حقيقة.

---

## 0. خلاصة تنفيذية

المنصة ليست بوابة واحدة لكل دور. يوجد **محرّك توجيه رسمي** (`ErvenowRoleRouting` / `resolvePostLoginPath`) يوجّه بعد الدخول إلى بوابات Portal 2.0 (`*-preview`)، ويوجد **خريطة قديمة موازية** (`account-destinations.js` / `ErvenowAccountDest`) ما زالت توجّه التاجر إلى `/store-dashboard`. صفحات HTML **ليست محمية بـ middleware على السيرفر** حسب الدور؛ الحماية API (`requireAuth` + `requireRole`) وطبقة JS اختيارية (`ErvenowAuthGuard` · `platform-access.js`). أي شخص يعرف الرابط يحمّل الصفحة؛ البيانات تفشل إن لم يكن الدور مناسباً.

**أخطر ازدواجية:** التاجر بعد Login يذهب إلى `/merchant-preview`، بينما زر «حسابي» في الهيدر يفتح `/store-dashboard`. نفس الحساب يرى لوحتين متنافستين.

---

## 1. الأدوار الموجودة فعلياً

### 1.1 أدوار قاعدة البيانات (`users.role`)

معرّفة في `shared/middleware/auth.js`:

| Role DB | المعنى | يُحوَّل إلى Portal |
| --- | --- | --- |
| `customer` | زائر / عميل المنصة | `customer` |
| `user` | مرادف قديم للعميل | `customer` |
| `driver` | مندوب توصيل | `driver` (أو `transport` إذا `service_type` نقل) |
| `store` | متجر | `merchant` |
| `merchant` | تاجر | `merchant` |
| `restaurant` | مطعم | `merchant` |
| `service` | مزوّد خدمة | `service` أو `transport` أو `driver` حسب `service_type` |
| `admin` | إدارة | `admin` |
| `blocked` | محظور | مسار الشكوى لا بوابة |

`provider` ليس دور DB؛ الواجهة تطبعه إلى `service`.

### 1.2 أدوار البوابة (Portal Roles)

من `shared/utils/resolvePortalRole.js` + `portalLaunch.js`:

| Portal | مسار ما بعد الدخول الرسمي | ملاحظة |
| --- | --- | --- |
| `customer` | `/start-now.html` | المنصة العامة — ليست Portal Framework |
| `merchant` | `/merchant-preview` | Portal 2.0 حيّ (`PORTAL_LIVE.merchant = true`) |
| `driver` | `/driver-preview` | Portal 2.0 حيّ |
| `service` | `/service-preview` | Portal 2.0 حيّ |
| `transport` | `/transport-preview` | مشتق من `service_type` نقل — ليس عمود role |
| `admin` | `/admin-dashboard` | خارج Portal Framework |

أنواع النقل (`TRANSPORT_PORTAL_TYPES`): `pickup_truck` · `car_transport` · `vehicle_transfer` · `furniture_move`.  
أنواع الخدمة المنزلية (`SERVICE_PORTAL_TYPES`): سباكة، كهرباء، مكيفات، غسيل، مشتل، غاز، تلميع…  
`internal_delivery` على حساب `service` يُوجَّه إلى بوابة **المندوب**.

---

## 2. صفحات تسجيل الدخول (كل الأدوار)

| الصفحة | Route | الملف | لمن | بعد النجاح |
| --- | --- | --- | --- | --- |
| دخول موحّد / تسجيل | `/login` · `/login?role=*` | `public/login.html` | عميل · متجر (role=store) · تسجيل مندوب/خدمة | `navigateAfterLogin` → `/api/core/login-destinations` ثم `ErvenowRoleRouting.resolvePostLoginPath` |
| دخول المندوب | `/driver-login` | `public/driver-login.html` | مندوب معتمد | `resolvePostLoginPath({role:driver})` → `/driver-preview` |
| دخول مزوّد الخدمة | `/service-provider-login` | `public/service-provider-login.html` | `role=service` فقط (يرفض غيره) | `resolvePostLoginPath(user)` → `/service-preview` أو `/transport-preview` |
| دخول الأدمن | `/admin-login` | `public/admin-login.html` | أدمن | ثابت `/admin-dashboard` (لا يستخدم RoleRouting) |
| موجّه قديم | `/delivery/login` | `public/delivery/login.html` | — | meta-refresh → `/driver-login` |
| دليل شركاء | `/partner-portal` | `public/partner-portal.html` | اختيار يدوي | روابط إلى `/login?role=store` أو `/service-provider-login` — ليست صفحة OTP |

سلوك `/login?role=…` قبل الرسم (`login.html` `preselectRole`):

- `role=admin` → `/admin-login`
- `role=driver` (وليس تسجيل) → `/driver-login`
- `role=service` أو نوع خدمة → `/service-provider-login`
- `role=customer` أو `store` يبقى في `/login`

تسجيل حساب جديد للعميل/المندوب/المتجر/الخدمة يتم من `/login?mode=register`. تسجيل المتجر التفصيلي أيضاً من `/register-store`. تسجيل المندوب أيضاً من `/driver-register`.

---

## 3. العميل — Customer

### 3.1 الدخول والتحويل

- **صفحة الدخول:** `/login?role=customer` (`public/login.html`)
- **بعد النجاح:** إن وُجد `?next=` داخلي يُحترم (ما عدا `blocked`). وإلا `/api/core/login-destinations` ثم الافتراضي **`/start-now.html`**.
- **لوحة رئيسية رسمية بعد الدخول:** `/start-now.html` (محرّك التوجيه).
- **لوحات رئيسية متنافسة يراها العميل يومياً:** `/` · `/start-now` · `/dashboard`.

### 3.2 التنقل بعد الدخول

| السطح | العناصر |
| --- | --- |
| هيدر (`guest-shell.js`) | الرئيسية `/` · منصة ERVENOW `/dashboard` · طلباتي `/my-orders` · الخريطة الحية `/live-map` · خروج (reload `/`) |
| Bottom nav ≤640px (`mobile-foundation.js`) | الرئيسية `/` · استكشاف `/start-now` · + (مطاعم/متاجر/خدمات/توصيل/غاز) · طلباتي `/my-orders` · حسابي **`/dashboard` إن وُجد توكن** |
| حسابي في الهيدر (رقم الجوال) | `ErvenowAccountDest.goHome` → `/start-now.html` |

ملاحظة: تبويب «حسابي» في الشريط السفلي يفتح `/dashboard` بينما التوجيه الرسمي بعد Login هو `/start-now.html`.

### 3.3 جدول صفحات العميل

| Role | الصفحة | Route | الملف | الوظيفة | كيف يصل إليها | نشطة/قديمة | يوجد تكرار؟ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| customer | الرئيسية التسويقية | `/` | `public/index.html` | هيرو · 4 أبواب · متاجر مقيّمة · كيف تعمل | هيدر · bottom nav | نشطة | تكرار جزئي مع start-now |
| customer | استكشاف / منزل التوجيه | `/start-now` · `/start-now.html` | `public/start-now.html` | بطاقات الأقسام الأربعة بعد الدخول الرسمي | Redirect بعد Login · bottom «استكشاف» | نشطة — المنزل الرسمي | تكرار جزئي مع `/` و `/dashboard` |
| customer | منصة ERVENOW (حساب/تصفح) | `/dashboard` | `public/dashboard.html` | تبويبات عروض/أقسام · حراسة جلسة | هيدر «منصة ERVENOW» · bottom «حسابي» | نشطة | تكرار جزئي — ثالث منزل |
| customer | مطاعم | `/restaurants` | `public/restaurants.html` | قائمة مطاعم · بحث · ترتيب | الأبواب · + | نشطة | — |
| customer | متاجر | `/stores` | `public/stores.html` | قائمة متاجر | الأبواب · + | نشطة | — |
| customer | خدمات | `/services` | `public/services.html` | مقدّمو خدمات | الأبواب · + | نشطة | — |
| customer | توصيل ونقل | `/delivery-services.html` | `public/delivery-services.html` | سطحة · طرود · غاز (غاز يُحوَّل) | الأبواب · + | نشطة | — |
| customer | توصيل غاز | `/gas-delivery` | `public/gas-delivery.html` | نموذج غاز | + · redirect من delivery-services?service=gas | نشطة | — |
| customer | تلميع مركبات | `/car-polishing` | `public/car-polishing.html` | حجز تلميع | رابط خدمة | نشطة | جزئي مع service-book |
| customer | حجز خدمة | `/service-book` | `public/service-book.html` | إتمام حجز خدمة | من `/services` | نشطة | — |
| customer | صفحة متجر للعميل | `/store` · `/store.html` | `public/store.html` | قائمة منتجات متجر واحد | من قوائم المتاجر | نشطة | — |
| customer | السلة / الدفع | `/checkout` (`/cart` → 302 هنا) | `public/checkout.html` | سلة مسودة · عنوان · دفع | هيدر سلة · إتمام طلب | نشطة | `/cart.html` موجود لكن المسار يُحوَّل |
| customer | دفع EW PAY | `/pay` | `public/pay.html` | إتمام بوابة الدفع | من checkout | نشطة | — |
| customer | طلباتي | `/my-orders` | `public/my-orders.html` | سجل طلبات العميل | هيدر · bottom · حراسة | نشطة | تكرار جزئي مع `/order` و `/track` |
| customer | تفاصيل طلب | `/order` | `public/order.html` | طلب واحد | من my-orders | نشطة | — |
| customer | تتبع | `/track` | `public/track.html` | تتبع حي | من الطلب | نشطة | `/delivery/map.html` يحوّل إلى هنا |
| customer | المحفظة | `/wallet` | `public/wallet.html` | رصيد · شحن · سجل | هيدر محفظة | نشطة | — |
| customer | الإشعارات | `/notifications` | `public/notifications.html` | مركز إشعارات مستقل | جرس الهيدر يمكن أن يفتحه | نشطة | الجرس أيضاً inline في الهيدر |
| customer | الخريطة الحية العامة | `/live-map` | `public/live-map.html` | خريطة أنشطة عامة | هيدر | نشطة | جزئي مع delivery-map |
| customer | خريطة طلب توصيل | `/delivery-map` | `public/delivery-map.html` | إنشاء طلب توصيل على الخريطة | تدفق توصيل | نشطة | `/delivery-request` → هنا |
| customer | تصفح ضيف قديم | `/browse` | `public/browse.html` | عروض بدون أسماء محلات | روابط قديمة | قديمة / استعمال ضعيف | تكرار مع الأقسام |
| customer | بوابة عميل Portal 2.0 | `/customer-preview` | — (301) | أُلغيت | أي رابط قديم | قديمة — تحويل إلى start-now | — |
| customer | العناوين | لا صفحة قائمة | — | العناوين تُلتقط في checkout/الخريطة | — | غير موجودة كصفحة | فجوة |
| customer | انتظار الموافقة | `/pending-approval.html` | `public/pending-approval.html` | حساب قيد المراجعة | بعد OTP إن pending | نشطة | — |
| customer | محظور | `/blocked-complaints` | `public/blocked-complaints.html` | شكوى لمحظور | role=blocked | نشطة | — |

**عدد صفحات العميل التشغيلية (بدون قانوني/موافقة):** 21 صفحة في الجدول أعلاه (بما فيها browse والمنزل الثلاثي).

**صفحات قانونية مشتركة (كل الزوار):** `/privacy-policy` · `/terms-of-use` · `/payments-refund-policy` · `/careers`.

**هل يصل لصفحات دور آخر؟** يمكن فتح URL أي لوحة (مثلاً `/store-dashboard`)؛ `ErvenowAuthGuard` يطلب `/login?role=store`. `/orders` يُحوَّل للعميل إلى `/my-orders` عبر `platform-access.js`. صفحات الأدمن تُحوَّل إلى `/dashboard` إن لم يكن أدمن **فقط إذا** تحمّل `platform-access.js`.

---

## 4. المندوب — Driver / Courier

### 4.1 الدخول والتحويل

- **صفحة الدخول:** `/driver-login` (`public/driver-login.html`). `/login?role=driver` يُحوَّل إليها.
- **تسجيل جديد:** `/login?mode=register&role=driver` أو `/driver-register`.
- **بعد النجاح:** `/driver-preview` (رسمي). `?next=` يُحترم.
- **`/driver` و `/driver-dashboard`:** 301 إلى `/driver-preview` في `server/server.js`.
- **ملف `public/driver.html` ما زال يُخدم عبر static على `/driver.html`** — لوحة كلاسيكية حية.

### 4.2 كم شاشة رئيسية أثناء العمل؟

**أربع منظومات متوازية** وليست لوحة واحدة:

| # | الشاشة | ماذا تغطي |
| --- | --- | --- |
| 1 | `/driver-preview` | Portal 2.0: لوحة · طابور جاهز · نشط · مكتمل · أرباح · محفظة · تقييم · إشعارات · إعدادات (hash sections) |
| 2 | `/driver.html` | لوحة كلاسيكية: قائمة طلبات + خريطة + إجراء التوصيل |
| 3 | `/orders` | طابور طلبات المنصة (dispatch) — حراسة `requireRole("driver")` على API |
| 4 | `/driver-app` | تتبع حي: تبويب قائمة + تبويب خريطة |

المحفظة `/driver-wallet` شاشة خامسة للأرباح/السحب (مكررة كقسم داخل preview).

الطلبات الجديدة / الطلب الحالي / السجل / الحساب **ليست في نظام واحد**. Preview يحاول جمعها؛ الكلاسيكي و`/orders` و`/driver-app` ما زالت في الهيدر (`driver-nav.js`).

### 4.3 جدول صفحات المندوب

| Role | الصفحة | Route | الملف | الوظيفة | كيف يصل إليها | نشطة/قديمة | يوجد تكرار؟ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| driver | بوابة المندوب 2.0 | `/driver-preview` | `public/driver-preview.html` + `assets/driver-preview.js` | المنزل الرسمي بعد الدخول · أقسام داخلية | Redirect Login · ROLE_HOME | نشطة رسمية | تكرار مؤكد مع driver.html |
| driver | لوحة كلاسيكية | `/driver.html` (و `/driver` يحوّل للـ preview) | `public/driver.html` | طلبات + خريطة + زر حالة | هيدر `driver-nav.js` ما زال يشير إلى **`/driver`** (الذي صار preview) | الملف قديم؛ المسار `/driver` صار preview | تكرار مؤكد |
| driver | طلبات المنصة | `/orders` | `public/orders.html` | طابور استلام طلبات | هيدر المندوب «طلبات المنصة» | نشطة | تكرار جزئي مع أقسام ready/active في preview |
| driver | التتبع الحي | `/driver-app` | `public/driver-app.html` | قائمة نشطة + خريطة GPS | هيدر «تتبع الحي» · guest-shell للمندوب | نشطة | تكرار جزئي مع خريطة driver.html وقسم active في preview |
| driver | المحفظة والسحب | `/driver-wallet` | `public/driver-wallet.html` | رصيد · سحب OTP | هيدر رصيد · رابط في driver.html | نشطة | تكرار جزئي مع قسم wallet/earnings في preview |
| driver | دخول | `/driver-login` | `public/driver-login.html` | OTP واتساب | تسجيل خروج المندوب يعود هنا | نشطة | — |
| driver | طلب انضمام | `/driver-register` | `public/driver-register.html` | تسجيل مندوب | من صفحة الدخول | نشطة | تكرار جزئي مع `/login?mode=register&role=driver` |
| driver | أرشيف توصيل | `/delivery/orders.html` | `public/delivery/orders.html` | refresh → `/driver` | رابط قديم | قديمة | — |
| driver | دخول توصيل قديم | `/delivery/login.html` | `public/delivery/login.html` | → `/driver-login` | رابط قديم | قديمة | — |

هيدر المندوب الكلاسيكي (`assets/driver-nav.js`): لوحة المندوب `/driver` · طلبات المنصة `/orders` · الرئيسية `/` · تتبع الحي `/driver-app` · رصيد `/driver-wallet` · خروج → `/driver-login`.

**عدد صفحات المندوب التشغيلية:** 5 (+ صفحتا دخول/تسجيل).

**وصول خاطئ لدور آخر:** المندوب **يُمنع من إنشاء طلبات** (`can_place_orders=false`)؛ `/checkout` و`/cart` يُحوَّلان إلى `/driver`. `/my-orders` يُحوَّل إلى `/orders`. التصفح العام (`/` · مطاعم) مسموح بلا سلة. صفحات الأدمن تُحوَّل إلى `/driver` إن تحمّل `platform-access.js`.

---

## 5. مزوّد الخدمة — Service Provider (+ نقل Transport)

هذا مصدر الازدواجية الذي لاحظته: **ليست صفحتان فقط، بل ثلاث بوابات + صفحة اختيار + أسماء مسارات قديمة تُحوَّل.**

### 5.1 الدخول والتحويل

- **دخول تشغيلي:** `/service-provider-login` — يرفض أي `role !== "service"`.
- **بعد النجاح:** `resolvePostLoginPath(user)`:
  - `service_type` نقل → `/transport-preview`
  - غير ذلك → `/service-preview`
- **تسجيل:** `/login?mode=register&role=service` (لا يوجد login منفصل للتسجيل).
- **مسارات قديمة:** `/provider-dashboard` و `/service-dashboard` → 302 `/services-provider`.
- لا يوجد ملف اسمه `provider.html` أو `service-provider.html` (عدا الدخول). `/partner-portal` دليل روابط فقط.

### 5.2 هل توجد صفحتان أثناء العمل؟ نعم — وأكثر

| البوابة | متى | ماذا تفعل |
| --- | --- | --- |
| `/service-preview` | المنزل الرسمي لمعظم `role=service` | Portal 2.0: لوحة · طلبات · جدولة · محفظة · تقييم · إشعارات · إعدادات |
| `/transport-preview` | `service_type` نقل أو مندوب بنوع نقل | Portal 2.0 نقل: طلبات نقل · أسطول · تسعير · محفظة |
| `/services-provider` | البوابة الكلاسيكية ما زالت حية | حجز طلبات ظاهرة · KPIs · دفع · نفس API `/api/services` |
| رابط داخل Portal | `role-context.js` sidebarFoot | «البوابة الكلاسيكية» → `/services-provider.html` صراحة |

المزوّد بعد الدخول الرسمي يرى Preview، ويجد في الشريط الجانبي رابطاً للوحة الكلاسيكية — **ازدواجية متعمّدة في الكود**.

حراسة الكلاسيكية: `ErvenowAuthGuard` بـ `/login?role=service` — بينما الدخول التشغيلي هو `/service-provider-login`. مسار ثالث للدخول.

### 5.3 جدول مزوّد الخدمة / النقل

| Role | الصفحة | Route | الملف | الوظيفة | كيف يصل إليها | نشطة/قديمة | يوجد تكرار؟ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| service | بوابة الخدمة 2.0 | `/service-preview` | `public/service-preview.html` | المنزل الرسمي | Login OTP | نشطة رسمية | تكرار مؤكد مع services-provider |
| transport | بوابة النقل 2.0 | `/transport-preview` | `public/transport-preview.html` | منزل شركاء النقل | Login حسب service_type | نشطة رسمية | تكرار جزئي مع services-provider |
| service | اللوحة الكلاسيكية | `/services-provider` | `public/services-provider.html` | طابور حجوزات · حجز · تنفيذ · دفع | sidebar Portal · partner-portal · aliases | نشطة مستخدمة | تكرار مؤكد |
| service | أسماء قديمة | `/provider-dashboard` · `/service-dashboard` | — | 302 → services-provider | روابط قديمة | تحويل فقط | — |
| service/store | دليل الشركاء | `/partner-portal` | `public/partner-portal.html` | اختيار متجر أو خدمة ثم Login | فوتر/روابط | نشطة كفهرس | ليست لوحة |
| service | دخول | `/service-provider-login` | `public/service-provider-login.html` | OTP | Login role=service | نشطة | تكرار جزئي مع `/login?role=service` الذي يُحوَّل لنفس الصفحة |

**عدد صفحات مزوّد الخدمة التشغيلية:** 3 بوابات (+ دخول + فهرس شركاء).

---

## 6. المتجر / التاجر — Merchant · Store · Restaurant

أدوار DB الثلاثة (`store` · `merchant` · `restaurant`) تُعامل Portal واحداً `merchant`.

### 6.1 الدخول والتحويل — تعارض صريح

| المصدر | بعد دخول التاجر |
| --- | --- |
| `login.html` + `login-destinations` + `portalLaunch.js` | **`/merchant-preview`** |
| `account-destinations.js` `ROLE_HOME.store/merchant/restaurant` | **`/store-dashboard`** |
| `store-shell.js` القائمة | `/store-dashboard` كـ «لوحة المتجر» |
| `portal-framework/role-context.js` sidebarFoot | رابط «لوحة المتجر» → `/store-dashboard` و Order Board |

النتيجة: **Login يفتح Portal 2.0؛ «حسابي» والهيدر الكلاسيكي يفتحان اللوحة القديمة.**

### 6.2 أين الطلبات / المنتجات / العروض / الإعدادات / الأرباح / الحالة / الساعات؟

| الاحتياج | أين يوجد اليوم |
| --- | --- |
| الإدارة الأساسية الرسمية بعد Login | `/merchant-preview` (أقسام hash: dashboard, orders, products, categories, offers, reviews, visitor-preview, wallet, withdrawals, reports, notifications, settings, pos) |
| الإدارة الأساسية التي يروّج لها الشِل الكلاسيكي | `/store-dashboard` — هوية · موقع · منتجات · محفظة/سحب · تقييمات · معاينة · إحصاء طلبات مختصر |
| الطلبات التفصيلية + إيرادات | `/merchant-dashboard` + `/order-board` (كانبان تشغيل) + قسم orders في preview |
| المنتجات | `#productsAnchor` في store-dashboard **و** قسم products في preview |
| العروض | قسم offers في preview فقط (سعر عرض على المنتج). لا صفحة عروض مستقلة في store-dashboard |
| الإعدادات | هوية/موقع/دفع في store-dashboard **و** settings في preview |
| الأرباح / التسويات | محفظة store-dashboard · withdrawals في preview · صفحة merchant-dashboard للإيرادات |
| حالة المتجر (مفتوح/مغلق) | شارة `is_open` للعميل من API. **لا واجهة ساعات عمل أو إيقاف المتجر** في store-dashboard أو preview settings |
| ساعات العمل | **غير موجودة كصفحة أو قسم** في لوحات التاجر المفحوصة |

### 6.3 جدول المتجر

| Role | الصفحة | Route | الملف | الوظيفة | كيف يصل إليها | نشطة/قديمة | يوجد تكرار؟ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| merchant | بوابة التاجر 2.0 | `/merchant-preview` | `public/merchant-preview.html` | المنزل الرسمي بعد Login · كل الأقسام في شِل واحد | RoleRouting | نشطة رسمية | تكرار مؤكد مع store-dashboard |
| merchant | لوحة تحكم المتجر | `/store-dashboard` · `/store-panel` | `public/store-dashboard.html` | هوية · منتجات · محفظة · موقع | AccountDest · store-shell · sidebar preview | نشطة مستخدمة بقوة | تكرار مؤكد |
| merchant | الطلبات والإيرادات | `/merchant-dashboard` | `public/merchant-dashboard.html` | إحصائيات · آخر طلبات · إيداعات | store-shell «الطلبات والإيرادات» | نشطة | تكرار جزئي مع preview orders/reports و order-board |
| merchant | Order Board | `/order-board` | `public/order-board.html` | تشغيل الطلبات لحظة بلحظة | store-shell · رابط من merchant-dashboard | نشطة | تكرار جزئي مع orders في preview |
| merchant | مطعم قديم | `/restaurant-dashboard` | — | 302 → store-dashboard | رابط قديم | تحويل | — |
| merchant | تسجيل متجر | `/register-store` | `public/register-store.html` | طلب انضمام متجر | فوتر · partner-portal | نشطة (قبل الاعتماد) | — |
| merchant | دخول | `/login?role=store` | `public/login.html` | OTP على نفس صفحة العميل مع اختيار دور متجر | كل روابط المتجر | نشطة | — |

هيدر المتجر (`store-shell.js`): لوحة المتجر · لوحة الطلبات · الطلبات والإيرادات · (خدماتي إن role=service) · صفحتي للعملاء · تواصل · خروج.

**عدد صفحات المتجر التشغيلية:** 4 لوحات (+ تسجيل).

---

## 7. الأدمن — Admin

### 7.1 كم صفحة رئيسية يمكن للأدمن الدخول منها؟

**ثلاث «لوحات رئيسية» + مجموعة أقمار صناعية:**

| # | المسار | الملف الذي يُخدم | النوع |
| --- | --- | --- | --- |
| 1 | `/admin-dashboard` | **`public/admin/admin-dashboard.html`** | الكونسول الرسمي بعد Login (server.js يتجاهل الملف الجذري) |
| 2 | `/admin-dashboard.html` | `public/admin-dashboard.html` (~5400 سطر، تصميم قديم مستقل) | **لوحة ثانية حية عبر static** — ليست مسار Login |
| 3 | `/admin/` · `/admin/index.html` | `public/admin/index.html` | شِل iframe يحمّل `/admin-dashboard` + تبويب Settings/Branding |

Login الأدمن يذهب فقط إلى (1). (2) و(3) وصول يدوي/قديماً.

### 7.2 الكونسول الرسمي — ماذا داخله؟

`public/admin/admin-dashboard.html` + `public/admin/modules/*`:

لوحة واحدة متعددة الألواح (`data-panel`): الجاهزية · الطلبات · المالية (قد تُخفى) · المناديب · المتاجر · الموافقات · الخدمات · النقل · فصل الأدوار · مراقبة المعاينة · سجل الأدوار · العروض · البنرات · Marketing Studio · البث · الإشعارات · الشكاوى · العملاء · التوظيف · الإعدادات · وحدات المنصة · ERVENOW PAY · حسابات الأدمن.

هيدر الكونسول: الرئيسية `/` · لوحة التحكم · الهوية `/admin/branding` · الأقسام `/admin/categories` · العروض (panel) · السحب `/admin/withdrawals` · صيانة الموقع · خروج → `/admin-login`.

حماية: `admin/modules/settings.js` يتحقق `profile.role === "admin"` وإلا `/admin-login`. APIs تحت `/api/admin/*` بـ `requireRole("admin")`. صلاحيات فرعية `adminPermissions` / `hasPermission`.

### 7.3 جدول الأدمن

| Role | الصفحة | Route | الملف | الوظيفة | كيف يصل إليها | نشطة/قديمة | يوجد تكرار؟ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin | الكونسول الموحّد | `/admin-dashboard` | `public/admin/admin-dashboard.html` | المنزل الرسمي · كل الألواح | Login · هيدر | نشطة رسمية | — |
| admin | لوحة HTML القديمة | `/admin-dashboard.html` | `public/admin-dashboard.html` | نسخة مستقلة ضخمة | URL مباشر (static) | قديمة لكن قابلة للفتح | تكرار مؤكد مع الكونسول |
| admin | شِل iframe | `/admin/` | `public/admin/index.html` | iframe للكونسول + settings + branding | URL مباشر | قديمة / تجريبية | تكرار جزئي |
| admin | دخول | `/admin-login` | `public/admin-login.html` | OTP · redirect ثابت للداشبورد | `/login?role=admin` | نشطة | لا يستخدم RoleRouting |
| admin | التقرير المالي | `/admin-finance` | `public/admin-finance.html` | تقرير يومي · سحوبات | روابط داخلية | نشطة قمر | تكرار جزئي مع لوح المالية في الكونسول |
| admin | مديونيات | `/admin-debts` | `public/admin-debts.html` | ديون عمولة | من finance | نشطة قمر | جزئي |
| admin | عمولات المزودين | `/admin/commissions` | `public/admin-commissions.html` | تحصيل ديون مزودين | من finance | نشطة قمر | جزئي |
| admin | طلبات السحب | `/admin/withdrawals` | `public/admin-withdrawals.html` | اعتماد سحب | هيدر الكونسول | نشطة قمر | جزئي مع financePanel |
| admin | الموافقات | `/admin-approvals` | `public/admin-approvals.html` | اعتماد حسابات/متاجر | روابط | نشطة قمر | تكرار جزئي مع panelApprovals |
| admin | الهوية | `/admin/branding` | `public/admin-branding.html` | شعار/ألوان المنصة | هيدر | نشطة | — |
| admin | الإعدادات | `/admin-settings` | `public/admin-settings.html` | إعدادات منصة مستقلة | iframe `/admin/` · روابط | نشطة قمر | تكرار جزئي مع panelSettings |
| admin | الأقسام | `/admin/categories` | `public/admin-categories.html` | تصنيفات | هيدر | نشطة | — |
| admin | إدارة البنرات (اسم قديم) | `/admin-banner-management` | — | 302 → `#panelHeroBanners` | رابط قديم | تحويل | — |

**عدد صفحات الأدمن:** 1 كونسول رسمي + 2 أغلفة متنافسة + 8 أقمار + دخول = **12** سطحاً (منها 3 «رئيسية»).

---

## 8. أدوار / مسارات أخرى

| النوع | المسار | ملاحظة |
| --- | --- | --- |
| `blocked` | `/blocked-complaints` | بعد Login إذا role/status محظور |
| `user` | يُطبع customer | لا بوابة مستقلة |
| `transport` | `/transport-preview` | Portal مشتق من service_type |
| معاينات UI | `/preview/*` · `/mobile-preview.html` | فهرس تصميم/أقسام — ليست runtime مستخدم |
| guest بدون توكن | معظم صفحات العميل تعمل كضيف إلى أن يطلب checkout |

---

## Login Flow

```
[اختيار صفحة الدخول]
   │
   ├─ /login?role=customer|store     → OTP واتساب (/api/core/send-otp · verify-otp)
   ├─ /login?role=driver             → 302/replace /driver-login → OTP
   ├─ /login?role=service            → replace /service-provider-login → OTP (يرفض غير service)
   ├─ /login?role=admin              → replace /admin-login → OTP → /admin-dashboard (ثابت)
   └─ /login?mode=register&role=*    → إنشاء عضوية (قد pending-approval)
           │
           ▼
   JWT في localStorage (ervenow_access_token + token) + cookie
           │
           ▼
   GET /api/core/me  → profile.role + service_type + status
           │
           ├─ pending  → /pending-approval.html
           ├─ blocked  → /blocked-complaints
           └─ active
                 │
                 ▼
   GET /api/core/login-destinations
           │
           ├─ أكثر من وجهة (مندوب+متجر بنفس الجوال…) → Role Picker في login.html
           └─ وجهة واحدة
                 │
                 ▼
   resolvePostLoginPath / portalPathForRole   ← المحرّك الرسمي
           │
           ├─ customer  → /start-now.html
           ├─ merchant  → /merchant-preview
           ├─ driver    → /driver-preview
           ├─ service   → /service-preview
           ├─ transport → /transport-preview
           └─ admin     → /admin-dashboard
```

### هل التوجيه موحّد؟ لا.

أماكن تقرر الوجهة بعد الدخول (كلها حية):

| # | المكان | ماذا يقرر |
| --- | --- | --- |
| 1 | `shared/utils/portalLaunch.js` + `resolvePortalRole.js` | المصدر الرسمي للخادم والاختبارات |
| 2 | `public/assets/role-routing.js` (`ErvenowRoleRouting`) | مرآة الواجهة — يستخدمها `login.html` و `driver-login` و `service-provider-login` |
| 3 | `shared/utils/loginDestinations.js` + `GET /api/core/login-destinations` | تعدد الأدوار لنفس الجوال |
| 4 | `public/assets/account-destinations.js` | زر حسابي / `goAccountHome()` — **خريطة مختلفة للتاجر:** `/store-dashboard` |
| 5 | `public/admin-login.html` | مسار ثابت `/admin-dashboard` بدون RoleRouting |
| 6 | `?next=` على صفحات الدخول | يتجاوز المنزل إن كان مساراً داخلياً |
| 7 | `platform-access.js` `guardPage` | تحويلات بعد التحميل (عميل↔مندوب، منع أدمن) |

Logout:

| السطح | السلوك |
| --- | --- |
| guest-shell (عميل) | مسح التوكن + `location.reload()` أو `/` |
| portal-shell (preview) | مسح جلسة + `location.replace(loginUrl)` الخاص بالدور |
| driver-nav | `/driver-login` |
| admin | `/admin-login` (`shared.js` / زر الهيدر) |

لا يوجد redirect logout موحّد.

---

## حماية الصفحات حسب Role

| الطبقة | ماذا تحمي | ماذا لا تحمي |
| --- | --- | --- |
| Express `requireAuth` + `requireRole` | كل `/api/*` الحساسة | ملفات HTML |
| `ErvenowAuthGuard.ensureApprovedAccount` | صفحات مدرجة يدوياً (dashboard, wallet, my-orders, store-dashboard, merchant-dashboard, order-board, services-provider, delivery-map, orders) | preview portals تعتمد حراسة داخل `*-preview.js`؛ كثير من صفحات العميل بلا حراسة جلسة |
| `platform-access.js` | أدمن URL · طابور `/orders` · منع مندوب من checkout | لا يُحمَّل في كل الصفحات؛ قائمة DRIVER_HUB **لا تشمل** `/driver-preview` |
| Portal shell | loginUrl حسب الدور عند غياب الجلسة | لا يمنع لصق URL لبوابة دور آخر بعد امتلاك أي توكن |

**ثغرة ازدواج/خلط:** مندوب يملك توكن يمكنه فتح `/merchant-preview` أو `/service-preview` في المتصفح؛ الصفحة قد تفشل على API أو تعرض فارغاً — لا يوجد redirect سيرفري.

---

## Duplicate Dashboards

### تكرار مؤكد

1. **تاجر:** `/merchant-preview` ↔ `/store-dashboard` (منزلان بعد الدخول حسب مصدر التوجيه).
2. **مزوّد خدمة:** `/service-preview` ↔ `/services-provider` (الشريط الجانبي يروّج للاثنين).
3. **مندوب:** `/driver-preview` ↔ `public/driver.html` (ملف كلاسيكي ما زال على `/driver.html`) ↔ وظائف `/orders` + `/driver-app`.
4. **أدمن:** `/admin-dashboard` (admin/) ↔ `/admin-dashboard.html` (الجذر static).
5. **عميل — ثلاثة منازل:** `/` · `/start-now.html` · `/dashboard`.
6. **دخول المندوب:** `/driver-login` ↔ `/login?role=driver` (الثاني يُحوَّل) ↔ `/delivery/login.html`.

### تكرار جزئي

| المجموعة | الصفحات | التداخل |
| --- | --- | --- |
| طلبات التاجر | merchant-preview#orders · order-board · merchant-dashboard | تشغيل + تقارير + كانبان |
| مالية التاجر | store-dashboard#wallet · preview#wallet/withdrawals · merchant-dashboard | رصيد/سحب/إيراد |
| طلبات المندوب | preview ready/active · /orders · /driver-app تبويب قائمة · driver.html | نفس دورة القبول/التوصيل |
| نقل | transport-preview · services-provider | حجوزات خدمة/نقل |
| مالية أدمن | financePanel داخل الكونسول · /admin-finance · /admin-debts · /admin/commissions · /admin/withdrawals | نفس كيانات API تقريباً |
| موافقات أدمن | panelApprovals · /admin-approvals | اعتماد حسابات |
| سلة العميل | /checkout · /cart.html (ملف) · /pay | /cart مسار يُحوَّل؛ الملف قد يبقى |
| إشعارات | جرس الهيدر · /notifications · أقسام notifications في البوابات | ثلاثة سطوح |

### صفحة قديمة (تحويل أو static مهجور)

| المسار | الحالة |
| --- | --- |
| `/customer-preview` | 301 → start-now |
| `/driver` · `/driver-dashboard` | 301 → driver-preview |
| `/provider-dashboard` · `/service-dashboard` | 302 → services-provider |
| `/restaurant-dashboard` | 302 → store-dashboard |
| `/delivery/index.html` | → `/` |
| `/delivery/orders.html` | → `/driver` → preview |
| `/delivery/map.html` | → `/track` |
| `/delivery-request` | 301 → delivery-map |
| `/admin-banner-management` | 302 → hash البنرات |
| `/browse` | حية لكن مسار ضيف قديم |
| `public/admin-dashboard.html` | حية بالـ URL `.html` فقط |
| `public/admin/index.html` | شِل iframe غير مربوط بـ Login |
| `public/partner-portal.html` | فهرس دخول مزدوج |

### صفحة غير مستخدمة / فجوة

- **ساعات عمل المتجر:** لا UI في أي لوحة تاجر.
- **إيقاف/فتح المتجر كصفحة إعدادات:** غير موجود (فقط `is_open` للعرض العام).
- **عناوين العميل كقائمة مستقلة:** غير موجودة (checkout فقط). `addresses` في RoleContext للعميل لكن `customer-preview` أُلغي.
- **`/cart` كواجهة:** يُحوَّل إلى checkout؛ `cart.html` لم يعد المسار العام.

### يمكن دمجها مستقبلاً (اقتراح بلا تنفيذ)

- تاجر: preview هو الهيكل؛ store-dashboard + merchant-dashboard + order-board تصبح أقساماً داخله.
- مندوب: preview هو الهيكل؛ إبقاء خريطة حية كقسم لا كـ `/driver-app` منفصل.
- مزوّد: preview (service/transport) هو الهيكل؛ إيقاف رابط «الكلاسيكية».
- عميل: `/` منزل عام؛ `/dashboard` يُطوى إلى حساب داخل `/` أو `/my-orders`+`/wallet`؛ `/start-now` يُدمج في `/` أو يبقى استكشاف فقط.
- أدمن: الكونسول فقط؛ الأقمار تُفتح كألواح أو تُحذف بعد نقل الوظائف.

---

## الهيدر · Sidebar · Bottom nav · الرجوع

| الدور | هيدر | Sidebar | Bottom nav | رجوع |
| --- | --- | --- | --- | --- |
| عميل | guest-shell: رئيسية، منصة، طلباتي، خريطة، سلة، محفظة، دخول/خروج | لا | 5 عناصر + FAB (جوال) | روابط «← الرئيسية» متفرقة |
| مندوب preview | portal-header + bottom nav تشغيلي | portal-sidebar أقسام hash | portal `showBottomNav` | خروج → driver-login |
| مندوب كلاسيكي | driver-nav.js | لا | لا (قد يظهر bottom العميل إن لم يُعطل) | خروج → driver-login |
| تاجر preview | portal-header | أقسام merchant + تذييل لـ store-dashboard/order-board | نعم في ops v2 | خروج → `/login?role=store` |
| تاجر كلاسيكي | store-shell | لا — ناف أفقي | لا | خروج عبر store-shell |
| خدمة preview | portal | أقسام + رابط كلاسيكي | نعم | خروج → service-provider-login |
| خدمة كلاسيكي | بسيط داخل الصفحة | لا | لا | — |
| أدمن | هيدر كونسول + قائمة جوال | ألواح داخل الصفحة لا مسار | لا | خروج → admin-login |

روابط Dashboard في الفوتر/الهيدر ما زالت تخلط `/dashboard` (عميل) مع لوحات الشركاء.

---

## Recommended Architecture

**بدون تنفيذ.** الشكل الأنظف المستهدف:

```
Customer  →  /                         (بوابة واحدة: تصفح + طلب)
              ├── /restaurants|/stores|/services|/delivery-services
              ├── /store/:id
              ├── /checkout
              ├── /my-orders · /order/:id · /track
              ├── /wallet · /notifications · /account (عناوين)
Driver    →  /driver                   (بوابة واحدة)
              ├── طابور · نشط · خريطة · سجل · محفظة · حساب   (أقسام لا مواقع)
Provider  →  /provider                 (بوابة واحدة؛ نقل كوضع داخلها أو /provider/transport)
              ├── طلبات · جدولة · محفظة · إعدادات
Merchant  →  /merchant                 (بوابة واحدة)
              ├── طلبات · منتجات · عروض · محفظة · إعدادات · حالة المتجر · ساعات العمل
Admin     →  /admin                    (بوابة واحدة)
              └── ألواح داخلية فقط — بلا /admin-*.html أقمار
```

قواعد مقترحة لاحقاً:

1. مصدر توجيه واحد: `resolvePostLoginPath` فقط (حذف خريطة `account-destinations` المخالفة).
2. صفحة دخول واحدة للشركاء مع اختيار الدور، أو الإبقاء على ثلاث دخولات بشرط ألا تتعارض الوجهة.
3. HTML لا يُخدم لدور خاطئ (حراسة سيرفر أو redirect موحّد من `platform-access` على كل الصفحات).
4. الأسماء القديمة تبقى 301 إلى البوابة الواحدة، لا تُفتح كتشغيل موازٍ.
5. Preview الحالي هو أقرب هيكل للبوابة الواحدة — اللوحات الكلاسيكية تُ Slug كأقسام لا كمنازل.

---

## أرقام للمراجعة السريعة

| المجموعة | العدد (تشغيلية حية تقريباً) |
| --- | ---: |
| صفحات العميل (تصفح+طلب+حساب، بلا قانوني) | **21** |
| صفحات المندوب التشغيلية | **5** |
| صفحات مزوّد الخدمة / النقل | **3** بوابات (+ فهرس شركاء) |
| صفحات المتجر التشغيلية | **4** |
| سطوح الأدمن (كونسول+أغلفة+أقمار+دخول) | **12** |
| عناقيد تكرار مؤكد | **6** |
| محرّكات قرار ما بعد Login الحية | **7** أماكن |

### أخطر حالات الازدواجية

1. **تاجر: Login → `/merchant-preview` بينما حسابي → `/store-dashboard`.** مستخدم واحد، منزلان، إعدادات منتجات مكررة.
2. **مزوّد خدمة: Preview الرسمي + `/services-provider` الكلاسيكي مربوط عمداً من الـ sidebar.** هذا مصدر ملاحظة «صفحتان أثناء العمل».
3. **مندوب: Preview + `/orders` + `/driver-app` + ملف `driver.html`.** الطلب الجديد والحالي والسجل موزعة على أنظمة.
4. **عميل: `/` و `/start-now` و `/dashboard` ثلاثة منازل؛ الشريط السفلي «حسابي» ≠ منزل Login.**
5. **أدمن: كونسول `admin/admin-dashboard.html` مقابل ملف جذري `admin-dashboard.html` ما زال يُفتح، إضافة لأقمار مالية/موافقات تكرر ألواح الكونسول.**
6. **خريطتان للتوجيه (`role-routing` vs `account-destinations`) تقرران وجهتين مختلفتين لنفس الدور `store`.**

---

## 9. حصر كل ملفات HTML في `public/` (73 ملفاً)

التصنيف حسب الاستخدام الفعلي عبر المسار، لا حسب وجود الملف على القرص.

### 9.1 تشغيل حي (يُخدم كصفحة)

| الملف | الدور | المسار الحي |
| --- | --- | --- |
| `index.html` | عميل/ضيف | `/` |
| `start-now.html` | عميل | `/start-now` |
| `dashboard.html` | عميل | `/dashboard` |
| `restaurants.html` · `stores.html` · `services.html` | عميل | `/restaurants` · `/stores` · `/services` |
| `delivery-services.html` | عميل | `/delivery-services.html` |
| `gas-delivery.html` · `car-polishing.html` · `service-book.html` | عميل | مسارات بنفس الاسم |
| `store.html` | عميل | `/store` |
| `checkout.html` · `pay.html` | عميل | `/checkout` · `/pay` |
| `my-orders.html` · `order.html` · `track.html` | عميل | `/my-orders` · `/order` · `/track` |
| `wallet.html` | عميل (+ أي دور عبر URL) | `/wallet` |
| `notifications.html` | مشترك | `/notifications` |
| `live-map.html` · `delivery-map.html` | عميل | `/live-map` · `/delivery-map` |
| `browse.html` | ضيف قديم | `/browse` |
| `login.html` | عميل/تاجر | `/login` |
| `register-store.html` | تاجر قبل الاعتماد | `/register-store` |
| `pending-approval.html` · `blocked-complaints.html` · `pre-registered.html` | حالات حساب | مسارات مباشرة |
| `privacy-policy.html` · `terms-of-use.html` · `payments-refund-policy.html` · `careers.html` | قانوني | مسارات مباشرة |
| `driver-login.html` · `driver-register.html` | مندوب | `/driver-login` · `/driver-register` |
| `driver-preview.html` | مندوب رسمي | `/driver-preview` |
| `driver.html` | مندوب كلاسيكي | **`/driver.html` فقط** (المسار `/driver` يحوّل للـ preview) |
| `orders.html` | مندوب | `/orders` |
| `driver-app.html` | مندوب | `/driver-app` |
| `driver-wallet.html` | مندوب | `/driver-wallet` |
| `service-provider-login.html` | خدمة | `/service-provider-login` |
| `service-preview.html` · `transport-preview.html` | خدمة/نقل | `/service-preview` · `/transport-preview` |
| `services-provider.html` | خدمة كلاسيكي | `/services-provider` |
| `partner-portal.html` | فهرس شركاء | `/partner-portal` |
| `merchant-preview.html` | تاجر رسمي | `/merchant-preview` |
| `store-dashboard.html` | تاجر كلاسيكي | `/store-dashboard` · `/store-panel` |
| `merchant-dashboard.html` · `order-board.html` | تاجر | `/merchant-dashboard` · `/order-board` |
| `admin-login.html` | أدمن | `/admin-login` |
| `admin/admin-dashboard.html` | أدمن رسمي | `/admin-dashboard` |
| `admin-dashboard.html` | أدمن قديم | **`/admin-dashboard.html` static** |
| `admin/index.html` | أدمن iframe | `/admin/` |
| `admin-finance.html` · `admin-debts.html` · `admin-commissions.html` · `admin-withdrawals.html` · `admin-approvals.html` · `admin-branding.html` · `admin-settings.html` · `admin-categories.html` | أدمن أقمار | مسارات `/admin-*` أو `/admin/*` |

### 9.2 تحويل سيرفر أو عميل (الملف باقٍ)

| الملف | ماذا يحدث |
| --- | --- |
| `customer-preview.html` | GET `/customer-preview` و `.html` → 301 `/start-now.html`. الملف + `assets/customer-preview.js` ما زالا على القرص |
| `driver-dashboard.html` | GET `/driver-dashboard` → 301 preview. الملف نفسه refresh/`location.replace("/driver")` إن فُتح كـ `.html` |
| `cart.html` | GET `/cart` → 302 `/checkout`. الملف حيّ إن فُتح `/cart.html` مباشرة عبر static |
| `delivery/index.html` | refresh → `/` |
| `delivery/login.html` | refresh → `/driver-login` |
| `delivery/orders.html` | refresh → `/driver` |
| `delivery/map.html` | يحوّل إلى `/track` |

### 9.3 مختبر تصميم — ليست runtime مستخدم

`preview/index.html` · `preview/restaurants-hub.html` · `preview/stores-hub.html` · `preview/services-hub.html` · `preview/delivery-hub.html` · `preview/home-hub-direct.html` · `mobile-preview.html`

**المجموع:** 73 HTML ≈ 55 تشغيل حي + 7 تحويل/يتيم + 7 مختبر + قانوني/حالات ضمن الحي.

---

## 10. الأقسام الداخلية للبوابات (شاشات بلا مسار مستقل)

هذه **شاشات عمل حقيقية** داخل hash/`shell.navigate`، وليست ملفات HTML. أي عدّ «كم صفحة يعمل منها الدور» يجب أن يشملها.

### تاجر — `/merchant-preview#…` (13 قسماً في `role-context.js`)

| القسم | الوظيفة الحية | أزرار/إجراءات رئيسة |
| --- | --- | --- |
| `dashboard` | KPI + اختصارات | الطلبات · المنتجات · السحب · الإعدادات |
| `orders` | تبويب جديدة/تجهيز/جاهزة/مكتملة | إجراء الحالة التالية · تفاصيل · طباعة · تتبع |
| `products` | كتالوج + نموذج | حفظ المنتج · مسح · تعديل · حذف |
| `categories` | فئات المتجر | حفظ · ترتيب أعلى/أسفل · تعديل · حذف |
| `offers` | سعر عرض على منتج | حفظ العرض من نفس نموذج المنتج |
| `reviews` | تقييمات الزوار | عرض فقط |
| `visitor-preview` | معاينة صفحة العميل | رابط فتح `/store` |
| `wallet` | رصيد وحركات | اختصار إلى السحب |
| `withdrawals` | طلب سحب OTP | إرسال طلب السحب |
| `reports` | مبيعات اليوم/أسبوع/شهر | تبويب الفترة |
| `notifications` | مركز إشعارات مضمّن | قراءة |
| `settings` | هوية · شعار · غلاف · موقع GPS · وسائل دفع | حفظ الهوية · GPS · حفظ الموقع |
| `pos` | **placeholder «Coming Soon»** | لا تشغيل |

تذييل السايدبار يفتح **خارج** البوابة: `/store-dashboard` و `/order-board`.

### مندوب — `/driver-preview#…`

| القسم | في الـ nav؟ | الوظيفة | أزرار رئيسة |
| --- | --- | --- | --- |
| `dashboard` | نعم | ملخص وردية | اختصارات للأقسام |
| `ready` | نعم | طابور جاهز للاستلام | قبول الطلب |
| `active` | نعم | قيد التوصيل | بدء · وصول · إتمام · تتبع حي |
| `completed` | نعم | السجل | عرض |
| `earnings` | نعم | أرباح | عرض |
| `wallet` | نعم | رصيد + سحب OTP | سحب (نفس مكوّن البوابة) |
| `rating` | نعم | متوسط التقييم | عرض |
| `notifications` | نعم | إشعارات مضمّنة | قراءة |
| `settings` | نعم | اسم/جوال/حالة | تبديل الحساب → `/driver-login` |
| `live-track` | **لا — ليس في `items`** | iframe إلى `/driver-app?order=#track` | يُفتح من زر في الطلب النشط فقط |

تذييل السايدبار: `/driver` (يصير preview) و `/driver-app`.

### مزوّد خدمة — `/service-preview#…`

`dashboard` · `requests` · `schedule` · `wallet` · `rating` · `notifications` · `settings`

أزرار التنفيذ على البطاقة: **حجز** · رفض · في الطريق · تقدّم · إتمام · إلغاء. تلميع المركبات وغاز لهما أزرار طور خاصة (`sp-cp-progress` · `sp-gas-start` · `sp-gas-finish`). GPS إلزامي لحجز غاز.

تذييل: «البوابة الكلاسيكية» → `/services-provider.html`.

### نقل — `/transport-preview#…`

`dashboard` · `transport-orders` · `wallet` · `notifications` · `fleet` · `pricing` · `settings`

تذييل: «بوابة النقل الكلاسيكية» → `/services-provider.html`.

### أدمن — ألواح داخل `/admin-dashboard` (`data-panel`)

`panelLaunchReadiness` · `panelOrders` · `financePanel` · `panelDrivers` · `panelStores` · `panelApprovals` · `panelServices` · `panelTransport` · `panelRoleSeparation` · `panelPreviewMonitor` · `panelRoleRegistry` · `panelOffers` · `panelHeroBanners` · `panelMarketingStudio` · `panelBroadcast` · `panelNotifications` · `panelComplaints` · `panelCustomers` · `panelJobs` · `panelSettings` · `panelPlatformModules` · `panelErvenowPay` (+ حسابات الأدمن من الصلاحيات).

ملفات JS: `public/admin/modules/*.js` (21 ملف وحدة).

---

## 11. الأزرار والوظائف حسب الصفحة المستقلة

### عميل

| الصفحة | أزرار/وظائف أساسية |
| --- | --- |
| `/` | 4 أبواب أقسام · اكتشاف متاجر مقيّمة · روابط تسجيل |
| `/start-now` | بطاقات مطاعم/متاجر/خدمات/توصيل بعد الدخول |
| `/dashboard` | تبويبات تصفح + حراسة جلسة `ErvenowAuthGuard` |
| قوائم الأقسام | بحث · ترتيب · فتح `/store` أو حجز خدمة |
| `/checkout` | إفراغ السلة · حفظ الموقع · تأكيد الطلب (معطّل حتى يكتمل العنوان/الدفع) |
| `/pay` | إتمام EW PAY |
| `/my-orders` | تحديث · إلغاء طلب · إلغاء المكرر · تتبع · طلب جديد → `/dashboard` |
| `/order` · `/track` | تفاصيل · تتبع حي · تقييم/إلغاء عبر API |
| `/wallet` | تحديث · إخفاء رصيد · شحن · تفعيل كود · سحب OTP (زر السحب يظهر لغير العميل حسب الدور) · سجل |
| `/notifications` | قراءة / قراءة الكل |
| `/delivery-map` | تحديد نقطة · إنشاء طلب توصيل (حراسة جلسة) |

شريط جوال (`mobile-foundation.js`): الرئيسية `/` · استكشاف `/start-now` · + أقسام · طلباتي `/my-orders` · حسابي = **`/dashboard` إن وُجد توكن** وإلا `/login?role=customer`.

هيدر (`guest-shell.js`): الرئيسية · منصة `/dashboard` · طلباتي (`/orders` للمندوب وإلا `/my-orders`) · خريطة · سلة · محفظة حسب الدور · أدمن إن admin · تتبع حي إن driver.

**محفظة الهيدر حسب الدور (انقسام إضافي):**

| الدور | رابط «رصيدك» |
| --- | --- |
| customer / service / افتراضي | `/wallet.html` |
| driver | `/driver-wallet` |
| store / merchant / restaurant | **`/store-dashboard#wallet`** — ليس `merchant-preview#wallet` |

### مندوب — الصفحات الكلاسيكية

| الصفحة | أزرار |
| --- | --- |
| `driver.html` | تحديث القائمة · زر الحالة الرئيسي (قبول/بدء/إتمام حسب الطلب المحدد) |
| `/orders` | طابور المنصة — قبول (حراسة → `/driver-login`) |
| `/driver-app` | تبويب قائمة + خريطة GPS + تتبع طلب |
| `/driver-wallet` | سحب OTP موازٍ لقسم wallet في preview و`/wallet` |

هيدر `driver-nav.js`: `/driver` · `/orders` · `/` · `/driver-app` · `/driver-wallet` · خروج `/driver-login`. **لا رابط مباشر إلى `/driver-preview` بالاسم** — `/driver` صار 301 إليه.

### مزوّد — الكلاسيكية `/services-provider`

جرس طلبات · تحديث · حفظ وسائل الدفع · **حجز الطلب** · إتمام. نفس دورة API `/api/services` التي يستخدمها preview.

### تاجر — الكلاسيكية

| الصفحة | أزرار |
| --- | --- |
| `/store-dashboard` | صفحة المتجر للعملاء · تحديث المعاينة · لصق موقع · GPS · حفظ الموقع · حفظ البروفايل · حفظ المنتج · مسح · تعديل/حذف منتج · طلب سحب |
| `/order-board` | تحديث · كانبان حالات الطلب (مودال تفاصيل) |
| `/merchant-dashboard` | إحصاء إيرادات + آخر طلبات + رابط Order Board |

هيدر `store-shell.js`: لوحة المتجر `/store-dashboard` · لوحة الطلبات `/order-board` · الطلبات والإيرادات `/merchant-dashboard` · خدماتي إن `role=service` → `/services-provider` · صفحتي للعملاء · تواصل · خروج. **لا يوجد بند إلى `/merchant-preview`.**

### أدمن — الأقمار

السحب اعتماد/رفض · الموافقات اعتماد متجر/مندوب · المالية تقرير يومي · المديونيات · العمولات · الهوية · الأقسام · الإعدادات المستقلة. كلها تستدعي `/api/admin/*` بـ `requireRole("admin")` وصلاحية فرعية عند الحاجة (`requireAdminPermission`).

---

## 12. حماية API حسب الدور (HTML لا يُحجب)

| مجموعة API | من يُسمح | ملاحظات |
| --- | --- | --- |
| `/api/admin/*` | `admin` فقط + أحياناً `adminPermissions` | الكونسول والأقمار |
| منتجات/محفظة/لوحة متجر `/api/store/*` الحساسة | `requireStoreRole` (store/merchant/restaurant) | `GET /my-store` · CRUD منتجات · wallet · order-board · merchant-hub · withdrawals |
| قائمة طعام | قراءة: أي جلسة · كتابة: store/restaurant/merchant/admin | `apps/food/routes.js` |
| مندوب `/api/driver/*` | محفظة/أرباح: `driver` · قبول/موقع: جلسة (التحقق داخل المعالج) | `/orders` HTML للمندوب |
| توصيل `/api/delivery/*` | إنشاء طلب: عميل قادر على الطلب · قبول/موقع: `driver` · تقييم/إلغاء: customer/admin | المندوب `can_place_orders=false` |
| محفظة `/api/wallet` | قراءة/شحن/تحويل: customer, driver, store, restaurant, merchant, service, admin | **سحب:** driver, store, restaurant, merchant, service — **ليس العميل ولا الأدمن** |
| إشعارات `/api/notifications` | أي جلسة | |
| checkout/order إنشاء | `requireAuth` + `denyUnlessCanPlaceOrders` + `denyUnlessPublicOrdering` | المندوب يُرفض |

لا يوجد middleware Express على `sendFile` حسب `profile.role`. من يعرف الرابط يحمّل HTML؛ JSON يرجع 401/403.

### حراسة الواجهة (ليست شاملة)

صفحات تستدعي `ErvenowAuthGuard.ensureApprovedAccount`:

`dashboard` · `wallet` · `my-orders` · `delivery-map` · `store-dashboard` · `merchant-dashboard` · `order-board` · `services-provider` · `orders` · وداخل `*-preview.js`.

**لا حراسة جلسة** على: الرئيسية، قوائم الأقسام، `store.html`، `checkout` (يُطلب عند الإرسال)، `browse`, معظم القانوني.

`platform-access.js` إن حُمّل: يمنع غير الأدمن من `/admin*`؛ يحوّل المندوب بعيداً عن `/cart|/checkout|/order`؛ يبادل `/orders` ↔ `/my-orders`. قائمة `DRIVER_HUB` **لا تتضمن** `/driver-preview` ولا `/driver.html` — لا إعادة توجيه من هناك، فقط لا تُعامل كـ «مركز مندوب» في ذلك الملف.

---

## 13. مصفوفة الوصول المتقاطع (ماذا يحدث إذا فتح دوراً آخر)

| من ↓ يفتح → | عميل (`/` `checkout` `my-orders`) | تاجر (`merchant-preview` `store-dashboard`) | مندوب (`driver-preview` `/orders`) | خدمة (`service-preview`) | أدمن |
| --- | --- | --- | --- | --- | --- |
| **ضيف** | تصفح نعم · طلب يحتاج OTP | HTML يُحمّل ثم AuthGuard → `/login?role=store` | AuthGuard → `/driver-login` | AuthGuard → `/login?role=service` (بينما الدخول التشغيلي `/service-provider-login`) | إن وُجد platform-access → `/dashboard` وإلا الصفحة تُرسم وتفشل API |
| **عميل** | نعم | نفس الحراسة؛ API 403 | `/orders` → `/my-orders` | 403 على API الخدمة | تحويل إن تحمّل platform-access |
| **تاجر** | تصفح عام نعم | نعم (لوحتان) | لا تحويل تلقائي | إن كان له `role=service` يظهر «خدماتي» في store-shell | تحويل إن platform-access |
| **مندوب** | تصفح بلا سلة؛ checkout/cart → `/driver`؛ my-orders → `/orders` | HTML قد يُفتح؛ API متجر 403 | نعم + أنظمة كلاسيكية | إن `service_type` نقل يُضاف destination إضافي | تحويل إلى `/driver` |
| **خدمة** | تصفح | 403 متجر | 403 مندوب إلا إن وُجد صف drivers بنفس الجوال | Preview + كلاسيكي | تحويل |
| **أدمن** | نعم | نعم عبر صلاحيات API | نعم | نعم | الكونسول + الأقمار |
| **محظور** | بعد Login → `/blocked-complaints` فقط كوجهة رسمية | — | — | — | — |

تعدد الوجهات لنفس الجوال (`loginDestinations.js`): إن وُجد مندوب `approved+active` بنفس الهاتف يُضاف `/driver-preview`؛ إن وُجد متجر معتمد يُضاف `/merchant-preview`؛ إن وُجد `service_type` مع دور غير service تُضاف بوابة الخدمة/النقل. `login.html` يعرض Role Picker.

---

## 14. تعارضات توجيه إضافية (بعد الجداول الأساسية)

| التعارض | المصدر أ | المصدر ب |
| --- | --- | --- |
| منزل التاجر بعد Login vs حسابي | `portalLaunch` → `/merchant-preview` | `account-destinations` + شريحة المحفظة → `/store-dashboard` |
| هيدر المتجر يتجاهل Portal | — | `store-shell.js` بدون رابط `/merchant-preview` |
| Preview التاجر يدعو للكلاسيكي | المنزل الرسمي | `sidebarFoot` → store-dashboard + order-board |
| حراسة مزوّد الكلاسيكي | دخول تشغيلي `/service-provider-login` | AuthGuard على الصفحة → `/login?role=service` (الذي يُحوَّل لنفس الدخول، مسار إضافي) |
| تتبع مندوب داخل preview | قسم `live-track` يعمل | غير موجود في nav؛ يضمّن `/driver-app` iframe |
| POS | بند في سايدبار التاجر | Coming Soon بلا API |
| عناوين العميل | مفتاح `addresses` في NAV_REGISTRY | لا دور `customer` في ROLE_CONFIGS؛ `customer-preview` ملغى |
| `internal_delivery` | Portal المندوب في `resolvePortalRole` | `account-destinations` يضعه ضمن أنواع **النقل** (`TRANSPORT_SERVICE_TYPES`) |

---

## 15. ألواح الأدمن × الأقمار (أين تتكرر الوظيفة)

| الوظيفة | داخل الكونسول | صفحة قمر |
| --- | --- | --- |
| الطلبات | `panelOrders` | — |
| المتاجر | `panelStores` | — |
| المناديب | `panelDrivers` | — |
| الموافقات | `panelApprovals` | `/admin-approvals` |
| الخدمات / النقل | `panelServices` · `panelTransport` | — |
| المالية / السحب | `financePanel` | `/admin-finance` · `/admin-debts` · `/admin/commissions` · `/admin/withdrawals` |
| العروض | `panelOffers` | — |
| البنرات | `panelHeroBanners` | اسم قديم `/admin-banner-management` → hash |
| Marketing Studio | `panelMarketingStudio` | — |
| الإعدادات / الهوية / الأقسام | `panelSettings` | `/admin-settings` · `/admin/branding` · `/admin/categories` |
| وحدات المنصة / PAY | `panelPlatformModules` · `panelErvenowPay` | — |
| بث / إشعارات / شكاوى / عملاء / وظائف | ألواح الكونسول | — |
| جاهزية الإطلاق | `panelLaunchReadiness` | — |

---

## أرقام محدّثة بعد الحصر الكامل

| البند | العدد |
| --- | ---: |
| ملفات HTML في `public/` | **73** |
| تشغيل حي كصفحة مستقلة | **~55** |
| تحويل / ملف يتيم على القرص | **7** |
| مختبر `/preview` + mobile-preview | **7** |
| أقسام hash تاجر | **13** (منها POS وهمي) |
| أقسام hash مندوب في الناف | **9** (+ live-track مخفي) |
| أقسام hash خدمة | **7** |
| أقسام hash نقل | **7** |
| ألواح أدمن داخل الكونسول | **~22** |
| عناقيد تكرار مؤكد | **6** |
| محرّكات قرار ما بعد Login | **7** |
| فجوات منتج بلا UI | ساعات العمل · فتح/إغلاق المتجر · قائمة عناوين العميل · POS |

ما يزال محظوراً: أي دمج أو حذف حتى تُراجع هذه الجداول.

---

*نهاية التدقيق (الجزء المتمّم 9–15). لا دمج ولا حذف حتى المراجعة.*

