# ERVENOW — الخريطة الكاملة للمنصة (جرد نهائي)

**النوع:** تحليل فقط — لا حذف ولا دمج ولا Redirect جديد ولا تعديل كود.  
**التاريخ:** 22 سبتمبر 2026  
**الهدف:** كل رابط حي → ماذا يفعل → لمن يتبع → ما الـAPI → وهل يوجد بديل يؤدي نفس العمل.

**مصادر الحقيقة (اليوم):**

- `server/server.js` — مسارات Express + Redirects قبل/بعد `express.static`
- `ervenow-frontend/` — مصدر الواجهة (تُزامَن إلى `public/` عبر `frontend:sync`)
- `ervenow-frontend/vercel.json` — Redirects إضافية على الاستضافة الثابتة
- `ervenow-frontend/assets/role-routing.js` + `shared/utils/portalLaunch.js` — منزل ما بعد الدخول
- `apps/*/routes.js` — واجهات API
- بوابات Portal 2.0: `*-preview.html` + `assets/portal-framework/configs/*.json`

**قاعدة الحماية:** ملفات HTML **ليست** محمية بـ middleware حسب الدور. أي شخص يعرف الرابط يحمّل الصفحة. البيانات تفشل عبر `requireAuth` / `requireRole` على `/api/*`. طبقة JS اختيارية: `ErvenowAuthGuard` · `platform-access.js`.

**أدوار DB:** `customer` · `user` (=عميل) · `driver` · `store` · `merchant` · `restaurant` · `service` · `admin` · `blocked`  
**أدوار البوابة:** `customer` · `merchant` · `driver` · `service` · `transport` (مشتق من `service_type` وليس عمود role) · `admin`

**منزل ما بعد الدخول الرسمي (`resolvePostLoginPath`):**

| Portal | المسار |
| --- | --- |
| customer | `/` |
| merchant | `/merchant-preview` |
| driver | `/driver-preview` |
| service | `/service-preview` |
| transport | `/transport-preview` |
| admin | `/admin-dashboard` |
| blocked | `/blocked-complaints` |

---

## جدول شامل لكل Route

الحالة واحدة من: **Production** · **Legacy** · **Redirect** · **Test/Lab** · **Orphan**

Alias `.html` لنفس الملف يُذكر في عمود Route ولا يُحسب سطراً مستقلاً إلا إذا كان السلوك مختلفاً (مثل `/driver` Redirect مقابل `/driver.html` صفحة حية).

| Group | Route | File | Role | الوظيفة | APIs | الحالة | Duplicate With |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Customer Home | `/` · `/index.html` | `index.html` | guest / customer | الرئيسية التسويقية + 4 أبواب + عروض + استكشاف `#snHomeHub` | `/api/core/me` · `/api/core/banners` · `/api/core/marketing/home` · `/api/core/platform-offers` · `/api/core/live-map-public` · `/api/stores` · `/api/store/products` · شرائح محفظة | Production | كانت تتكرر مع `/start-now` و `/dashboard` (الآن Redirect إلى هنا) |
| Customer Auth | `/login` · `?role=` · `?mode=register` | `login.html` | الكل عدا admin التشغيلي | بوابة OTP واتساب الموحّدة + تسجيل عميل/متجر/مندوب/خدمة | `/api/core/send-otp` · `/api/core/verify-otp` · `/api/core/register` · `/api/core/register-account` · `/api/core/login-destinations` · `/api/core/me` · `/api/health` | Production | صفحات الدخول القديمة صارت Redirect إلى هنا |
| Customer Checkout | `/checkout` | `checkout.html` | customer (ضيف حتى الدفع) | السلة + العنوان + الدفع + إنشاء الطلب الموحّد | `/api/order/create` · `/api/core/send-otp` · `/api/core/verify-otp` · `/api/core/checkout-payment-methods` · `/api/wallet` · `/api/store/public/:id` · `/api/store/products` · `/api/store/public/:id/delivery-quote` · `/api/store/resolve-maps-link` | Production | `/cart` Redirect · `/cart.html` ما زال يضع طلباً |
| Customer Cart | `/cart` | — | customer | تحويل إلى checkout | — | Redirect | `/checkout` |
| Customer Cart | `/cart.html` | `cart.html` | customer | واجهة سلة checkout-v3؛ تستطيع إنشاء طلب | نفس محرّك `cart.js` → `/api/order/create` | Legacy | `/checkout` |
| Customer Orders | `/my-orders` | `my-orders.html` | customer (حراسة) | سجل طلبات العميل | `/api/core/me` · `/api/order/orders` · `/api/order/:id` | Production | جزئي مع `/order` و `/track` |
| Customer Orders | `/order` | `order.html` | guest / customer | «طلب جديد» من متجر (مسودة قديمة) | `/api/store/:id` | Legacy | `/store` + `/checkout` |
| Customer Track | `/track` | `track.html` | customer (ناعم) | تتبع حي + إلغاء + تقييم + فاتورة | `/api/order/:id` · `/api/order/:id/cancel` · `/api/order/:id/rate` · `/api/invoice/:id` · socket.io | Production | `/delivery/map.html` يحوّل إلى هنا |
| Customer Wallet | `/wallet` · `/wallet.html` | `wallet.html` | customer (حراسة) | رصيد · شحن · استرداد كود · سحب OTP · سجل | `/api/wallet` · `/api/wallet/transactions` · `/api/wallet/topup-request` · `/api/wallet/redeem-code` · `/api/wallet/withdraw/send-otp` · `/api/wallet/withdraw/confirm-otp` · `/api/core/wallet-pay-settings` · `/api/wallet/pay-settings` | Production | شرائح `#wallet` في بوابات الشركاء (أدوار أخرى) |
| Customer Notif | `/notifications` | `notifications.html` | أي جلسة | مركز إشعارات مستقل | `/api/notifications` · `/api/notifications/unread-count` · `/api/notifications/read/:id` · `/api/notifications/read-all` | Production | جرس الهيدر + أقسام notifications في Preview |
| Customer Pay | `/pay` | `pay.html` | customer / driver / provider | جلسة سداد مديونية (EW Pay) | `/api/pay/debt-info` · `/api/pay/create-session` · `/api/pay/mock-complete` | Production | ليس شحن المحفظة |
| Discover | `/restaurants` | `restaurants.html` | guest | قائمة مطاعم | `/api/stores` · `/api/categories?type=restaurant` | Production | `preview/restaurants-hub.html` · جزئي `/browse` |
| Discover | `/stores` | `stores.html` | guest | قائمة متاجر | `/api/stores` | Production | `preview/stores-hub.html` · جزئي `/browse` |
| Discover | `/services` | `services.html` | guest | دليل الخدمات المنزلية | `/api/services/catalog` | Production | `preview/services-hub.html` · `/service-book` |
| Discover | `/browse` | `browse.html` | guest | تصفح عام حسب النوع | `/api/store?type=&sort=` | Legacy | `/restaurants` · `/stores` |
| Discover | `/store` · `/store.html` | `store.html` | guest | كتالوج متجر واحد + إضافة للسلة | `/api/store/:id` · `/api/store/products` · `/api/store/product-categories` · `/api/store/reviews` · delivery-quote | Production | `/order` |
| Delivery | `/delivery-services.html` | `delivery-services.html` | guest | محور توصيل/نقل: سطحة · طرود · أثاث · غاز | مسودة → `/checkout` · `/api/delivery/resolve-maps-link` · OSRM | Production | `/delivery-map` · `/gas-delivery` · `preview/delivery-hub.html` |
| Delivery | `/delivery-services.html?service=gas_delivery` | — | guest | تحويل إلى صفحة الغاز | — | Redirect | `/gas-delivery` |
| Delivery | `/gas-delivery` · `.html` | `gas-delivery.html` | guest | تبديل أسطوانة / تعبئة مركزي → مسودة | `ErvenowOrderDraftVertical` → `/checkout` | Production | محور التوصيل |
| Delivery | `/car-polishing` · `.html` | `car-polishing.html` | guest | حجز تلميع مركبات → مسودة | تسعير محلي + مسودة → `/checkout` | Production | `/service-book` · `/services` |
| Delivery | `/service-book` · `.html` | `service-book.html` | guest | إتمام حجز خدمة من الكتالوج | `/api/services/catalog` → مسودة `/checkout` | Production | `/services` · `/car-polishing` |
| Delivery | `/delivery-map` · `.html` | `delivery-map.html` | customer (حراسة) | إنشاء طلب توصيل على الخريطة | `/api/core/me` · `/api/delivery/resolve-maps-link` · مسار إنشاء الطلب | Production | `/delivery-services.html` · `/delivery-request` |
| Delivery | `/delivery-request` · `.html` | — | — | 301 → `/delivery-map` | — | Redirect | `/delivery-map` |
| Maps | `/live-map` | `live-map.html` | guest | خريطة أنشطة عامة / متاجر | `/api/core/live-map-public` · `/api/core/platform-branding` · `/api/store/live-map/stores` | Production | جزئي مع `/delivery-map` (غرض مختلف: عرض مقابل إنشاء) |
| Legal | `/privacy-policy` | `privacy-policy.html` | public | سياسة الخصوصية | لا | Production | — |
| Legal | `/terms-of-use` | `terms-of-use.html` | public | شروط الاستخدام | لا | Production | — |
| Legal | `/payments-refund-policy` | `payments-refund-policy.html` | public | الدفع والاسترداد | لا | Production | — |
| Public | `/careers` | `careers.html` | public | التوظيف | `POST /api/admin/job-applications/public` | Production | لوح Jobs في الأدمن |
| Public | `/partner-portal` | `partner-portal.html` | public | فهرس انضمام شركاء | لا (روابط تسجيل) | Production | `/login?mode=register` |
| Account | `/pending-approval.html` | `pending-approval.html` | pending | انتظار اعتماد الحساب | لا | Production | — |
| Account | `/pre-registered.html` | `pre-registered.html` | public | تأكيد التسجيل المسبق | لا | Production | — |
| Account | `/blocked-complaints` | `blocked-complaints.html` | blocked | شكوى لمحظور | `/api/core/me` · `POST /api/delivery/complaints` · `GET /api/delivery/complaints/mine` | Production | لوح Complaints في الأدمن |
| Retired customer | `/dashboard` · `.html` | ملف محذوف | — | 302 → `/` | — | Redirect | `/` |
| Retired customer | `/start-now` · `.html` | ملف متقاعد / Redirect | — | 302 → `/` (الاستكشاف صار `/#snHomeHub`) | — | Redirect | `/` |
| Retired customer | `/customer-preview` · `.html` | الملف ما زال على القرص | — | 302 → `/` (السيرفر قبل static) | — | Redirect | `/` |
| Merchant Hub | `/merchant-preview` · `.html` | `merchant-preview.html` + `merchant-preview.js` | store / merchant / restaurant | **المنزل الرسمي للتاجر** — لوحة + طلبات + منتجات + فئات + عروض + تقييم + محفظة + سحب + تقارير + إعدادات + POS stub | `/api/store/my-store` · `merchant-dashboard` · `order-board` · `products` CRUD · `merchant-categories` · `reviews` · `withdrawals` · `merchant-hub` · `location` · `/api/order/:id/action` · `/api/order/:id/status` · `/api/core/checkout-payment-methods` | Production | مجموعة التاجر كاملة أدناه |
| Merchant Classic | `/store-dashboard` | `store-dashboard.html` | store / merchant / restaurant | لوحة كلاسيكية: هوية · منتجات (مخزون/صور متعددة) · محفظة · موقع · تقييمات — **بدون تشغيل طلبات** | نفس كتالوج/محفظة المتجر بدون order-board actions وبدون merchant-categories CRUD | Legacy | `/merchant-preview` |
| Merchant Classic | `/store-panel` | نفس `store-dashboard.html` | نفس | Alias لنفس الملف | نفس | Legacy | `/store-dashboard` |
| Merchant Classic | `/restaurant-dashboard` | — | restaurant | 302 → `/store-dashboard` | — | Redirect | `/store-dashboard` |
| Merchant Ops | `/order-board` | `order-board.html` + `order-board.js` | store / merchant / restaurant | كانبان تشغيل الطلبات + طباعة + خريطة تفصيل | `/api/store/order-board` · `PATCH /api/order/:id/status` | Production (قمر) | `#orders` في preview |
| Merchant Finance | `/merchant-dashboard` | `merchant-dashboard.html` | store / merchant / restaurant | إيرادات + KPIs + جدول طلبات بخطوة حالة + سجل إيداع | `/api/store/merchant-dashboard` · `PATCH /api/order/:id/status` | Legacy | preview reports/wallet + order-board |
| Merchant Onboard | `/register-store` | `register-store.html` | تسجيل متجر (توكن تسجيل) | طلب انضمام متجر متعدد الخطوات | `/api/categories` · `POST /api/store/register` · `POST /api/store/resolve-maps-link` | Production | `/login?mode=register&role=store` يبدأ المسار |
| Driver Hub | `/driver-preview` · `.html` | `driver-preview.html` + `driver-preview.js` | driver | **المنزل الرسمي للمندوب** — جاهز/نشط/تتبع/مكتمل/أرباح/محفظة/تقييم | `/api/driver/orders` · `accept` · `start-delivery` · `complete-order` · `update-location` · `wallet` · `earnings` · `rating` · `/api/wallet/withdraw/*` | Production | مجموعة المندوب |
| Driver Classic | `/driver` | — | driver | 301 → `/driver-preview` | — | Redirect | `/driver-preview` |
| Driver Classic | `/driver.html` | `driver.html` | driver | لوحة كلاسيكية حية عبر static: قائمة + خريطة Leaflet + قبول/بدء/إكمال | `/api/driver/orders` · accept/start/complete · `update-location` · `/api/delivery/orders/:id/location` | Legacy | `/driver-preview` |
| Driver Queue | `/orders` | `orders.html` | driver / admin | طابور «طلبات المنصة» — مصدر قائمة مختلف | **`GET /api/order/orders`** + إجراءات `/api/driver/*` | Legacy | preview ready/active |
| Driver Track | `/driver-app` | `driver-app.html` | driver | تتبع حي: تبويب قائمة + خريطة + **وصلت للعنوان** | `/api/driver/orders` · `start-delivery` · **`ping-arrival`** · `complete-order` · `/api/delivery/orders/:id` | Legacy | `#live-track` في preview |
| Driver Wallet | `/driver-wallet` | `driver-wallet.html` | driver | محفظة مستقلة + سحب OTP | `/api/driver/wallet` · `/api/wallet` · `/api/wallet/transactions` · withdraw OTP | Legacy | `#wallet` في preview |
| Driver Retired | `/driver-dashboard` | — (السيرفر) | — | 301 → `/driver-preview` | — | Redirect | `/driver-preview` |
| Driver Retired | `/driver-dashboard.html` | `driver-dashboard.html` | — | static ثم meta → `/driver` → preview | — | Redirect | `/driver-preview` |
| Service Hub | `/service-preview` · `.html` | `service-preview.html` + `service-preview.js` | service (غير نقل) | **المنزل الرسمي لمزوّد الخدمة** — طلبات/قبول/رفض/في الطريق/بدء/إكمال/جدولة/محفظة | `/api/services/me/dashboard` · `me/schedule` · `bookings/:id/reserve|reject|cancel-task|complete` · `PATCH .../status` · `me/location` · wallet withdraw | Production | `/services-provider` |
| Service Classic | `/services-provider` · `.html` | `services-provider.html` | service | لوحة كلاسيكية: حجز/إكمال + طرق دفع — بلا رفض/جدولة/en-route | `/api/services/me/dashboard` · `bookings/:id/reserve|complete` · `me/location` · checkout-payment-methods | Legacy | `/service-preview` |
| Service Alias | `/service-dashboard` | — | — | 302 → `/services-provider` | — | Redirect | `/services-provider` |
| Service Alias | `/provider-dashboard` | — | — | 302 → `/services-provider` | — | Redirect | `/services-provider` |
| Transport Hub | `/transport-preview` · `.html` | `transport-preview.html` + `transport-preview.js` | service/driver + نوع نقل | بوابة نقل: طلبات · أسطول · تسعير · محفظة (نفس محرّك `/api/services`) | `me/dashboard` · `me/fleet` · `me/pricing` · `bookings/:id/reserve|complete` · wallet | Production | وضع من Service لا دور DB مستقل |
| Admin Auth | `/admin-login` | `admin-login.html` | admin | دخول أدمن معزول OTP | `/api/admin/auth/send-otp` · `/api/admin/auth/verify-otp` · `/api/core/me` | Production | `/login?role=admin` يوجّه إلى هنا |
| Admin Portal | `/admin-dashboard` | `admin/admin-dashboard.html` + `admin/modules/*` | admin | **الكونسول الرسمي** متعدد الألواح | انظر قسم الإدارة | Production | `/admin-dashboard.html` الجذري |
| Admin Legacy | `/admin-dashboard.html` | `admin-dashboard.html` (جذر) | admin | لوحة HTML قديمة مستقلة ما زالت تُفتح عبر static | مجموعة `/api/admin/*` مضمّنة | Legacy | `/admin-dashboard` |
| Admin Shell | `/admin` · `/admin/` · `/admin/index.html` | `admin/index.html` | admin | 302 سيرفر → الكونسول (الملف شِل iframe إن فُتح مباشرة قبل التحويل) | — | Redirect | `/admin-dashboard` |
| Admin Tool | `/admin-finance` | `admin-finance.html` | admin | تقرير يومي + سحوبات | `/api/admin/daily-report` · `/api/admin/withdraws` | Legacy | `financePanel` |
| Admin Tool | `/admin-debts` | `admin-debts.html` | admin | ديون مزودين | `/api/admin/provider-debts` | Legacy | financePanel · commissions |
| Admin Tool | `/admin/commissions` | `admin-commissions.html` | admin | تحصيل عمولات مزودين | ديون المزودين | Legacy | `/admin-debts` |
| Admin Tool | `/admin/withdrawals` | `admin-withdrawals.html` | admin | اعتماد/رفض سحب مناديب ومتاجر | `/api/admin/withdrawals/drivers|stores` · approve/reject | Production (قمر) | financePanel |
| Admin Tool | `/admin/branding` | `admin-branding.html` | admin | هوية المنصة + طرق دفع | `/api/admin/platform-settings` · `/api/admin/checkout-payment-methods` | Production (قمر) | panelSettings |
| Admin Tool | `/admin-settings` | `admin-settings.html` | admin | إعدادات مستقلة | `/api/admin/settings` · `/update` | Legacy | `panelSettings` |
| Admin Tool | `/admin/categories` | `admin-categories.html` | admin | تصنيفات المنصة | `/api/admin/categories` CRUD | Production (قمر) | — |
| Admin Redirect | `/admin-approvals` | `admin-approvals.html` | admin | sendFile ثم JS → `/admin-dashboard#approvals` | — | Redirect | `panelApprovals` |
| Admin Redirect | `/admin-banner-management` | — | admin | 302 → `/admin-dashboard#panelHeroBanners` | — | Redirect | `panelHeroBanners` |
| Login Legacy | `/driver-login` · `.html` | `driver-login.html` (stub) | driver | 302 سيرفر + JS → `/login?role=driver` | API القديمة `/api/driver/send-otp` **غير مستدعاة من الصفحة** | Redirect | `/login` |
| Login Legacy | `/service-provider-login` · `.html` | stub مماثل | service | 302 → `/login?role=service` | — | Redirect | `/login` |
| Login Legacy | `/driver-register` · `.html` | stub | driver | 302 → `/login?mode=register&role=driver` | `/api/driver/register` ما زال موجوداً في الـAPI | Redirect | `/login` |
| Login Legacy | `/delivery/login.html` | `delivery/login.html` | — | JS → `/login?role=driver` | — | Redirect | `/login` |
| Delivery Legacy | `/delivery/index.html` | `delivery/index.html` | — | → `/` | — | Redirect | `/` |
| Delivery Legacy | `/delivery/orders.html` | `delivery/orders.html` | — | → `/driver` → preview | — | Redirect | `/driver-preview` |
| Delivery Legacy | `/delivery/map.html` | `delivery/map.html` | — | → `/track` | — | Redirect | `/track` |
| Design | `/mobile-preview.html` | `mobile-preview.html` | — | إطار أجهزة لمعاينة الصفحات | لا | Test/Lab | — |
| Design | `/preview/` | `preview/index.html` | — | فهرس معاينات تصميم | لا | Test/Lab | الرئيسية الحية |
| Design | `/preview/home-hub-direct.html` | نفس | — | تجربة هب الرئيسية | لا | Test/Lab | `/` |
| Design | `/preview/stores-hub.html` | نفس | — | تجربة هب المتاجر | لا | Test/Lab | `/stores` |
| Design | `/preview/restaurants-hub.html` | نفس | — | تجربة هب المطاعم | لا | Test/Lab | `/restaurants` |
| Design | `/preview/services-hub.html` | نفس | — | تجربة هب الخدمات | لا | Test/Lab | `/services` |
| Design | `/preview/delivery-hub.html` | نفس | — | تجربة هب التوصيل | لا | Test/Lab | `/delivery-services.html` |
| Orphan | `/erwenow.html` | `erwenow.html` فارغ | — | ملف فارغ بدون مسار موجّه | لا | Orphan | — |

---

# 1. الصفحة الرئيسية والعميل

المنزل الوحيد الحي للعميل بعد تقاعد `/start-now` و `/dashboard` و `/customer-preview` هو **`/`**. الشريط السفلي: الرئيسية `/` · استكشاف `/#snHomeHub` · طلباتي `/my-orders` · حسابي → `/` للعميل المسجّل (أو بوابة الدور للشريك).

## `/` — الرئيسية

- **الملف:** `ervenow-frontend/index.html`
- **الوظيفة:** هيرو · أربعة أبواب (مطاعم / متاجر / خدمات / توصيل) · عروض · متاجر مقيّمة · استكشاف داخل الصفحة
- **Login؟** لا للتصفح. السلة والطلب يحتاجان OTP عند الإتمام
- **Role:** guest + customer (شركاء يرون شرائح دور)
- **أهم الأزرار →:** `/restaurants` · `/stores` · `/services` · `/delivery-services.html` · `/checkout` · `/login` · `/my-orders` · `/live-map` · `/wallet` حسب الدور
- **Duplicate:** لا منزل عميل منافس حي. الملفات المتقاعدة تُحوَّل إلى هنا

## `/login`

- بوابة OTP واتساب لكل الأدوار العامة. `role` في الرابط تلميح UI/تسجيل فقط؛ الحساب الموجود يُقرأ من DB.
- بعد النجاح: `GET /api/core/login-destinations` ثم `ErvenowRoleRouting.resolvePostLoginPath`
- تسجيل جديد: `?mode=register&role=customer|store|driver|service` — اختيار المتجر يفتح `/register-store`
- `role=admin` يبقى خارجاً على `/admin-login`

## `/checkout` (و `/cart.html`)

انظر القسم 8. الصفحة المعتمدة للدفع هي `/checkout`. المسار `/cart` Redirect. الملف `/cart.html` ما زال حيّاً عبر static ويستطيع إنشاء طلب — ازدواج تشغيلي.

## `/my-orders` · `/order` · `/track`

ضع هذه الثلاث متتابعة لأنها تغطي دورة الطلب بعد الإنشاء:

### طلبات العميل

`/my-orders`  
وظيفتها: قائمة كل طلبات الحساب مع روابط التتبع.

`/order`  
وظيفتها: بناء طلب متجر قديم (ليست تفاصيل طلب قائم). مسار إنشاء مكرر مع `/store` + `/checkout`.

`/track`  
وظيفتها: خريطة حية لطلب واحد + إلغاء + تقييم + فاتورة.

**درجة الازدواجية:** جزئي (`/order` إنشاء قديم؛ `/my-orders` و `/track` مكملان لا بديلان كاملان).

**الفرق الحقيقي:** القائمة ≠ التتبع ≠ إنشاء المسودة القديمة.

**الأفضل كواجهة:** `/my-orders` + `/track` هما المسار الحي. `/order` أقدم وظيفياً.

## `/wallet` · `/notifications`

صفحات حساب العميل المستقلة. الإشعارات تتكرر كجرس في الهيدر وكأقسام hash في بوابات الشركاء. محفظة العميل لا تُدار من Preview (العميل ليس له Portal 2.0).

## اكتشاف المتاجر والخدمات

### اكتشاف الكتالوج

`/restaurants`  
وظيفتها: قائمة مطاعم مع فئات.

`/stores`  
وظيفتها: قائمة متاجر.

`/browse`  
وظيفتها: تصفح عام أقدم بدون هوية القسم.

`/store`  
وظيفتها: متجر واحد + منتجات + تقييم + إضافة للسلة.

**درجة الازدواجية:** جزئي (`/browse` مع القائمتين). `/store` مكمل.

**الأفضل كواجهة:** `/restaurants` و `/stores` أحدث كهُب. `/browse` أضعف هوية.

### محور الخدمات للعميل

`/services`  
وظيفتها: دليل أنواع الخدمة.

`/service-book`  
وظيفتها: نموذج حجز عام → مسودة checkout.

`/car-polishing`  
وظيفتها: مُكوِّن تلميع مخصص → مسودة.

**درجة الازدواجية:** جزئي (نفس النتيجة: مسودة خدمة في السلة).

**الأفضل كواجهة:** `/car-polishing` أغنى لهذا النوع؛ `/service-book` أعم لبقية الأنواع.

### محور التوصيل للعميل

`/delivery-services.html`  
وظيفتها: مدخل سطحة / طرود / أثاث / غاز.

`/gas-delivery`  
وظيفتها: تدفق غاز متخصص.

`/delivery-map`  
وظيفتها: نقطة التقاط على الخريطة لطلب توصيل.

`/live-map`  
وظيفتها: خريطة عامة للعرض لا للإنشاء.

**درجة الازدواجية:** جزئي بين الثلاث الأُوَل (إنشاء طلب توصيل/خدمة ميدانية). `/live-map` غرض مختلف.

**الأفضل كواجهة:** `/delivery-map` أقوى للالتقاط الجغرافي؛ `/gas-delivery` أكمل للغاز؛ المحور أفضل كفهرس.

---

# 2. المتاجر والمطاعم

أدوار DB `store` · `merchant` · `restaurant` = بوابة واحدة `merchant`.  
لا يوجد `restaurant-dashboard.html`. `/restaurant-dashboard` → `/store-dashboard`.  
Login بعد النجاح → `/merchant-preview`. هيدر `store-shell` «لوحة المتجر» يشير الآن إلى `/merchant-preview` أيضاً. الصفحات الكلاسيكية ما زالت حية ومربوطة من داخل بعضها.

## إدارة المتجر

`/merchant-preview`  
وظيفتها: Portal 2.0 — كل الأقسام في شِل واحد (hash): dashboard · orders · products · categories · offers · reviews · visitor-preview · wallet · withdrawals · reports · notifications · settings · pos (قريباً).

`/store-dashboard` · `/store-panel`  
وظيفتها: لوحة كلاسيكية للهوية والمنتجات والمحفظة والموقع والتقييمات. عدّاد طلبات فقط. سحب بدون حقل IBAN. أغنى نموذج منتج (مخزون + صور متعددة + حذف).

`/merchant-dashboard`  
وظيفتها: تقرير إيرادات + جدول طلبات بخطوة حالة + سجل إيداعات. لا كتالوج.

`/order-board`  
وظيفتها: تشغيل الطلبات لحظة بلحظة (فلاتر، بطاقات، طباعة حرارية، خريطة في التفاصيل).

`/register-store`  
وظيفتها: انضمام متجر قبل الاعتماد — ليست لوحة تشغيل.

**درجة الازدواجية:** كامل تقريباً بين preview و (store-dashboard + order-board + merchant-dashboard) مجتمعة. كل كلاسيكية تغطي شريحة.

**الفرق الحقيقي:** Preview يجمّع. store-dashboard أقوى كتالوج. order-board أقوى كانبان. merchant-dashboard أقوى سجل مالي كلاسيكي.

**الأفضل كواجهة:** Preview أكمل وأحدث هيكلاً. store-dashboard أغنى نموذج منتج حتى اليوم.

### أين توجد الوظائف؟

| الاحتياج | merchant-preview | store-dashboard | merchant-dashboard | order-board |
| --- | :---: | :---: | :---: | :---: |
| الطلبات (تشغيل) | نعم | لا (عدّاد) | نعم خفيف | نعم الأعمق كلاسيكياً |
| المنتجات | نعم | نعم + مخزون/صور متعددة/حذف | عدّاد فقط | لا |
| الفئات | نعم CRUD + إعادة ترتيب | تعيين فئة للمنتج فقط | لا | لا |
| الأسعار | نعم | نعم | لا | لا |
| الصور | نعم (منتج + شعار/بنر) | نعم أقوى متعدد | لا | لا |
| العروض | قسم مستقل `offer_price` | حقل على نموذج المنتج | لا | لا |
| المحفظة | نعم | نعم | رصيد + إيداعات | شريحة شِل فقط |
| السحب | نعم + IBAN | نعم بلا IBAN | لا | لا |
| الأرباح | تقارير من الطلبات | KPI إيراد | **التركيز** | لا |
| الإعدادات | نعم | هوية/دفع/موقع | لا | لا |
| بيانات المتجر | نعم | نعم | ترويسة فقط | لا |
| التقييمات | نعم | نعم | لا | لا |
| حالة المتجر مفتوح/مغلق | **لا في أي لوحة** | لا | لا | لا |
| ساعات العمل | **لا في أي لوحة** | لا | لا | لا |
| POS | عنصر قائمة «قريباً» | لا | لا | لا |
| معاينة صفحة العميل | رابط `/store.html?preview=1` | نفس الفكرة | رابط | رابط |

**فريد في واحدة:**

- فئات التاجر CRUD + عروض كقسم + IBAN سحب + إشعارات/تقارير/POS stub → **preview فقط**
- مخزون + صور متعددة + حذف منتج أوضح → **store-dashboard**
- سجل إيداعات كجدول مالي → **merchant-dashboard**
- طباعة حرارية + عدّادات حالة + خريطة تفصيل الطلب → **order-board**

---

# 3. المندوب

`/driver` و `/driver-dashboard` Redirect إلى `/driver-preview`.  
**`/driver.html` ما زال يُخدم عبر static** — هذا أخطر مسار كلاسيكي حي للمندوب.

هيدر `driver-nav.js`: لوحة `/driver-preview` · طلبات المنصة `/orders` · الرئيسية `/` · تتبع `/driver-app` · الرصيد → preview `#wallet`.

## تشغيل المندوب

`/driver-preview`  
وظيفتها: المنزل الرسمي — جاهز · نشط · تتبع حي · مكتمل · أرباح · محفظة · تقييم · إشعارات · إعدادات.

`/driver.html`  
وظيفتها: لوحة كلاسيكية قائمة + خريطة + زر الحالة الرئيسي (قبول/بدء/إكمال).

`/orders`  
وظيفتها: طابور استلام من **`GET /api/order/orders`** (مصدر قائمة مختلف عن `/api/driver/orders`).

`/driver-app`  
وظيفتها: تتبع GPS بتبويبين. **الوحيدة التي تستدعي `POST /api/driver/ping-arrival/:id`** (وصلت للعنوان).

`/driver-wallet`  
وظيفتها: محفظة وسحب OTP مستقلان.

**درجة الازدواجية:** كامل تقريباً لدورة القبول→التوصيل→الإكمال عبر أربع أسطح. المحفظة مكررة. الوصول (`ping-arrival`) فريد في `/driver-app`.

**الأفضل كواجهة:** Preview أحدث وأشمل. `/driver-app` أغنى للخريطة اللحظية. `/orders` مصدر بيانات مختلف يجب الانتباه له قبل أي دمج لاحق.

### مصفوفة التشغيل

| الاحتياج | preview | driver.html | /orders | driver-app | driver-wallet |
| --- | :---: | :---: | :---: | :---: | :---: |
| الطلبات المتاحة | نعم | نعم | نعم | جزئي (طلباتي) | — |
| قبول الطلب | نعم | نعم | نعم | لا | — |
| الطلب الحالي | نعم | نعم | نعم | نعم | — |
| الخريطة | قسم live-track | Leaflet | رابط فقط | Leaflet | — |
| التتبع | نعم | نعم | → app | نعم | — |
| الاستلام كخطوة مستقلة | لا (مدموج مع القبول) | لا | لا | لا | — |
| بدء التوصيل | نعم | نعم | نعم | نعم | — |
| وصلت للعنوان | لا | لا | لا | **نعم** | — |
| الإكمال | نعم | نعم | نعم | نعم | — |
| الأرباح | نعم | لا | لا | لا | إحصاء جزئي |
| المحفظة | نعم | رابط | رابط | لا | نعم |
| السحب | نعم | لا | لا | لا | نعم |
| متاح / غير متاح | **لا زر تشغيل** (مؤشر GPS + متصفح) | لا | لا | لا | لا |

---

# 4. مزودو الخدمات

Login يذهب حسب `service_type`: منزلي → `/service-preview` · نقل → `/transport-preview` · `internal_delivery` → بوابة المندوب.  
Configs الحالية `sidebarFoot: []` — رابط «الكلاسيكية» لم يعد في شريط Portal. الصفحة الكلاسيكية ما زالت حية ومربوطة من الرئيسية (`index.html` قائمة دور) ومن `notification-center.js`.

## تشغيل مزوّد الخدمة

`/service-preview`  
وظيفتها: طلبات كاملة: قبول · رفض · إلغاء مهمة · في الطريق · بدء · إكمال · جدولة · محفظة · تقييم KPI · GPS.

`/services-provider`  
وظيفتها: طابور حجوزات كلاسيكي: حجز + إكمال + طرق دفع. بلا رفض/en-route/جدولة كواجهة.

`/service-dashboard` · `/provider-dashboard`  
وظيفتها: Redirect إلى الكلاسيكية **وليس** إلى Preview — هذا يعني أن الأسماء القديمة ما زالت تغذّي اللوحة غير الرسمية.

**درجة الازدواجية:** كامل للقبول/الإكمال. Preview أغنى لدورة التنفيذ.

**الأفضل كواجهة:** Preview أكمل وأحدث. الكلاسيكية أبسط كطابور.

### مصفوفة الخدمة

| الاحتياج | service-preview | services-provider |
| --- | :---: | :---: |
| استقبال الطلبات | نعم | نعم |
| الحجز / القبول | نعم | نعم (حجز) |
| الرفض | نعم | لا |
| في الطريق | نعم | لا |
| بدء الخدمة | نعم | لا |
| الإكمال | نعم | نعم |
| الجدولة | نعم | لا |
| المحفظة | نعم | رابط `/wallet` |
| السحب | نعم | عبر `/wallet` |
| الموقع | نعم | POST موقع المهمة |
| التقييمات | متوسط/عدد | حقول تقييم في اللوحة |

---

# 5. النقل

`transport` **ليس دور DB**. يُشتق من `service` أو `driver` عندما يكون `service_type` واحداً من: `pickup_truck` · `car_transport` · `vehicle_transfer` · `furniture_move`.

## بوابة النقل

`/transport-preview`  
وظيفتها: طلبات نقل · أسطول · تسعير · محفظة · إعدادات. APIs كلها `/api/services/*`.

`/services-provider`  
وظيفتها: قد يظهر نفس حجوزات النقل في الطابور الكلاسيكي لأن المصدر `me/dashboard`.

صفحات العميل المرتبطة (ليست لوحة مزوّد): `/delivery-services.html` (سطحة / أثاث) · `/car-polishing` (خدمة لا نقل) · لا توجد صفحة مستقلة اسمها pickup-truck.html أو furniture.html.

**درجة الازدواجية مع الخدمات:** جزئي — نفس محرّك الحجوزات، شِل مختلف (أسطول + تسعير بدل جدولة منزلية).

**هل مستقلة؟** واجهة مستقلة نعم. نظام حساب/API لا — وضع من Service Provider.

**الأفضل كواجهة:** `/transport-preview` للنقل. لا تُعامل كدور ثالث في قاعدة البيانات.

---

# 6. الإدارة

## التقسيم

### Admin Portal (رسمي)

- `/admin-login` — OTP معزول `/api/admin/auth/*`
- `/admin-dashboard` — `admin/admin-dashboard.html` + وحدات `admin/modules/*.js`

**ألواح الكونسول (`data-panel`):**

| لوح | Module | الوظيفة |
| --- | --- | --- |
| panelLaunchReadiness | launch-readiness.js | جاهزية الإطلاق + الطلب العام |
| panelOrders | orders.js | الطلبات · تعيين/نقل مندوب · إلغاء |
| financePanel | finance.js | ملخص مالي · ديون · تحصيل (قد يُخفى) |
| panelDrivers | drivers.js | المناديب اعتماد/حظر/تفعيل |
| panelStores | panels.js | طلبات المتاجر |
| panelApprovals | approvals.js | موافقات التسجيل |
| panelServices | services.js | مزودو الخدمة |
| panelTransport | transport.js | شركاء النقل |
| panelRoleSeparation | readiness-monitor.js | مراقبة فصل الأدوار |
| panelPreviewMonitor | readiness-monitor.js | مراقبة المعاينة |
| panelRoleRegistry | readiness-monitor.js | سجل الأدوار |
| panelOffers | offers.js | عروض المنصة |
| panelHeroBanners | hero-banners.js | البنرات |
| panelMarketingStudio | marketing-studio.js | تجربة الرئيسية |
| panelBroadcast | broadcast.js | البث |
| panelNotifications | panels.js | إشعارات المناديب |
| panelComplaints | panels.js | الشكاوى |
| panelCustomers | panels.js | العملاء حظر/تفعيل |
| panelJobs | panels.js | التوظيف |
| panelSettings | settings.js | صيانة الموقع · حسابات الأدمن · الميزات |
| panelPlatformModules | platform-modules.js | وحدات المنصة |
| panelErvenowPay | ervenow-pay.js | شحن/أكواد/اعتماد (قد يُخفى) |

هيدر الكونسول يفتح أيضاً أقماراً: `/admin/branding` · `/admin/categories` · `/admin/withdrawals`.

### Admin Modules

الملفات في `ervenow-frontend/admin/modules/`: `api.js` · `bootstrap.js` · `shared.js` · `sockets.js` · `dashboard.js` + الألواح أعلاه.

### Admin Tools (صفحات HTML مستقلة حية)

- `/admin/withdrawals` — اعتماد السحب
- `/admin/branding` — الهوية
- `/admin/categories` — الأقسام
- `/admin-finance` · `/admin-debts` · `/admin/commissions` — مالية قديمة
- `/admin-settings` — إعدادات قديمة

### Legacy

- `/admin-dashboard.html` الجذري — لوحة ثانية كاملة عبر static (**ليست** مسار Login)
- `/admin-settings` يتكرر مع `panelSettings`
- `/admin-finance` / debts / commissions تتكرر مع `financePanel`

### Design/Test

لا صفحة تصميم أدمن منفصلة. مراقبة الجاهزية داخل الكونسول.

**درجة الازدواجية:** كامل بين الكونسول المعياري و`/admin-dashboard.html`. جزئي قوي بين financePanel والأقمار المالية. موافقات: اللوح الرسمي؛ `/admin-approvals` Redirect فقط.

**الأفضل كواجهة:** `/admin-dashboard` المعياري أحدث وأوسع. الأقمار المالية ما زالت أعمق لبعض جداول السحب/الديون.

---

# 7. Login / Register

| Route | الحالة | API المستخدمة من الصفحة | تسجيل مكرر؟ |
| --- | --- | --- | --- |
| `/login` | حي — البوابة العامة | `/api/core/send-otp` · `verify-otp` · `register` · `login-destinations` | المصدر |
| `/login?role=store` + `/register-store` | حي — تسجيل متجر تفصيلي بعد OTP | `/api/store/register` | تكملة لا بديل كامل |
| `/login?mode=register&role=driver` | حي | `/api/core/register` | نعم مقابل API `/api/driver/register` غير مربوطة بالصفحة |
| `/login?mode=register&role=service` | حي | `/api/core/register` | لا صفحة تسجيل خدمة ثانية |
| `/admin-login` | حي مستقل | `/api/admin/auth/send-otp` · `verify-otp` | منعزل عن `/login` عن قصد |
| `/driver-login` | Redirect | لا تستدعي `/api/driver/send-otp` بعد الآن | — |
| `/service-provider-login` | Redirect | — | — |
| `/driver-register` | Redirect | — | — |
| `/delivery/login.html` | Redirect | — | — |
| `/partner-portal` | حي فهرس | لا API | روابط إلى `/login?mode=register` |

**هل يوجد تسجيل مكرر؟** نعم على مستوى API لا UI: `/api/driver/register` و `/api/driver/send-otp` ما زالا في الخادم بينما الواجهة الموحّدة تستخدم `/api/core/*`. تسجيل المتجر له مسار UI ثانٍ مشروع (`/register-store`) بعد OTP.

---

# 8. Cart / Checkout / Orders

المسارات التي تؤدي نفس مهمة إنشاء الطلب متجاورة:

## إنشاء الطلب

`/checkout` + `checkout-engine.js`  
الصفحة الرسمية. `POST /api/order/create` (canonical).

`/cart.html` + `cart.js`  
نفس الإنشاء من صفحة أخرى. المسار `/cart` لا يفتحها.

`POST /api/checkout`  
API قديمة deprecated تستدعي نفس `handleUnifiedCartCheckoutHttp`.

`POST /api/delivery/create` · `POST /api/delivery/orders`  
إنشاء توصيل ميداني (ما زال حيّاً في الخادم؛ الواجهة الحديثة تمر عبر order/create أو المسودة).

`POST /api/services/home-order` · `/gas-order` · `/bookings` · `/checkout`  
مسارات خدمة قديمة بجانب المسودة الموحّدة.

`/order`  
يبني مسودة متجر ثم يخرج عن المسار الحديث.

## المسودة (Draft)

- `assets/order-draft-store.js` — مفتاح `ervenow:order-draft`
- `order-draft-vertical.js` — غاز / خدمات / خريطة
- `pre-cart-delivery.js` — اختيار fulfillment قبل الإضافة
- بُناة المسودة: `store.html` · `gas-delivery` · `car-polishing` · `service-book` · `delivery-services` · `delivery-map`

## بعد الإنشاء

- قائمة: `GET /api/order/orders`
- تفاصيل: `GET /api/order/:id`
- إجراءات موحّدة: `POST /api/order/:id/action` (`start_preparing` · `mark_ready` …)
- حالة قديمة: `PATCH /api/order/:id/status`
- إلغاء / تقييم / تأكيد استلام

## Fulfillment Groups

ليست مورداً في API. التجميع على العميل حسب `store_id` ونوع السطر (`product` / توصيل خريطة / خدمة). أوضاع التنفيذ: `pickup` · `ervenow_delivery` · `store_delivery` عبر `/api/store/public/:id/delivery-quote` و `/api/store/delivery-engine/flags`.

**درجة الازدواجية:** كامل بين `/checkout` و `/cart.html` و `POST /api/checkout`. جزئي بين order/create ومسارات delivery/services القديمة.

**الأفضل كواجهة:** `/checkout` + `POST /api/order/create`.

---

# 9. Wallet / Payments / Finance

## واجهات المحفظة (نفس الرصيد، أسطح متعددة)

### محفظة العميل

`/wallet`  
الوحيدة كصفحة كاملة للعميل: شحن · كود · سحب OTP · سجل.

### محفظة التاجر

`/merchant-preview#wallet` + `#withdrawals`  
و `/store-dashboard#walletAnchor`  
و نظرة في `/merchant-dashboard`  
API سحب التاجر: `/api/store/withdrawals` (ليس نفس مسار OTP العام بالضرورة).

### محفظة المندوب

`/driver-preview#wallet`  
و `/driver-wallet`  
API: `/api/driver/wallet` مع fallback `/api/wallet`.

### محفظة الخدمة / النقل

`#wallet` داخل preview + سحب OTP عبر `/api/wallet/withdraw/*`.  
الكلاسيكية تشير إلى `/wallet` العامة (غير متخصصة).

**هل يوجد أكثر من UI لنفس المحفظة؟ نعم — لكل دور شريك على الأقل سطحان.**

## مدفوعات وLedger

| الموضوع | أين |
| --- | --- |
| ERVENOW Pay (شحن العميل) | `/wallet` + checkout `ew_pay` + لوح `panelErvenowPay` |
| سداد مديونية | `/pay` |
| Ledger إداري | `/api/wallet/ledger/deposit|pay|refund` · `/api/admin/wallet-ervenow-summary` · integrity-check |
| Refunds | `/api/finance/orders/:id/refund` — **لا صفحة عميل** |
| Commission | `/api/finance/commission-rules` · `/api/test/commission/:id` · صفحات ديون الأدمن |
| محفظة مالية موازية | `/api/finance/wallet/me` — أقل استخداماً من HTML |

**ازدواج API:** `/api/wallet/*` مقابل `/api/finance/wallet/*` مقابل `/api/store/wallet` مقابل `/api/driver/wallet`.

---

# 10. الصفحات القديمة والمختبرية

لا تُخلط مع الإنتاج في القرارات. القائمة كما هي اليوم:

## Redirect فقط

`/dashboard` · `/start-now` · `/customer-preview` · `/driver` · `/driver-dashboard` · `/driver-login` · `/driver-register` · `/service-provider-login` · `/service-dashboard` · `/provider-dashboard` · `/restaurant-dashboard` · `/cart` · `/delivery-request` · `/admin` · `/admin-banner-management` · `/admin-approvals` (بعد التحميل) · `/delivery/index.html` · `/delivery/orders.html` · `/delivery/map.html` · `/delivery/login.html`

## Legacy حي (يُفتح ويعمل)

`/browse` · `/order` · `/cart.html` · `/store-dashboard` · `/merchant-dashboard` · `/driver.html` · `/orders` · `/driver-app` · `/driver-wallet` · `/services-provider` · `/admin-dashboard.html` · `/admin-finance` · `/admin-debts` · `/admin/commissions` · `/admin-settings`

## Test / Lab

`/mobile-preview.html` · `/preview/*` (ستة ملفات هب)

## Orphan

- `/erwenow.html` فارغ
- `customer-preview.html` على القرص لكن المسار Redirect قبل static
- `/api/food/*` و `/api/market/*` بلا صفحة HTML تستدعيهما في الجرد الحالي
- `/api/driver/send-otp` · `/api/driver/register` بلا صفحة تستدعيهما بعد توحيد الدخول

---

# Duplicate / Overlapping Groups

الصفحات داخل كل مجموعة متجاورة عن قصد.

## 1) Merchant Portal Group

1. `/merchant-preview` — المنزل الرسمي بعد Login؛ كل الأقسام
2. `/store-dashboard` (`/store-panel`) — كتالوج + هوية + محفظة كلاسيكية
3. `/merchant-dashboard` — إيرادات وجدول طلبات
4. `/order-board` — كانبان تشغيل
5. `/restaurant-dashboard` — Redirect إلى store-dashboard

**المشترك:** نفس أدوار المتجر ونفس APIs الأساسية `/api/store/*` و `/api/order/:id/status`.  
**الفريد:** انظر مصفوفة القسم 2.  
**الازدواجية:** كامل على مستوى «إدارة المتجر» إذا جُمعت الكلاسيكيات؛ كل صفحة منفردة جزئية.

## 2) Driver Portal Group

1. `/driver-preview` — رسمي
2. `/driver.html` — كلاسيكي حي
3. `/orders` — طابور بمصدر API مختلف
4. `/driver-app` — خريطة + ping-arrival
5. `/driver-wallet` — محفظة
6. `/driver` · `/driver-dashboard` — Redirect

**المشترك:** قبول / بدء / إكمال عبر `/api/driver/*`.  
**الفريد:** `ping-arrival` في app فقط؛ أرباح منظمة في preview؛ `/orders` يقرأ `/api/order/orders`.

## 3) Service Provider Group

1. `/service-preview` — رسمي وأغنى دورة
2. `/services-provider` — كلاسيكي حي
3. `/service-dashboard` · `/provider-dashboard` — Redirect إلى الكلاسيكي (لا إلى Preview)

**خطر إضافي:** الأسماء القديمة تغذّي اللوحة غير الرسمية.

## 4) Transport vs Service Group

1. `/transport-preview`
2. `/service-preview` (إن دخل نوع نقل بالخطأ يُنصح بالتحويل)
3. `/services-provider`
4. صفحات العميل `/delivery-services.html` (سطحة/أثاث)

النقل وضع Portal على حساب service.

## 5) Admin Console Group

1. `/admin-dashboard` — معياري
2. `/admin-dashboard.html` — مونوليث static
3. `/admin/index.html` — Redirect/شِل iframe
4. `/admin` — Redirect

## 6) Admin Finance Group

1. `financePanel` داخل الكونسول
2. `/admin-finance`
3. `/admin-debts`
4. `/admin/commissions`
5. `/admin/withdrawals`

## 7) Admin Approvals Group

1. `panelApprovals`
2. `/admin-approvals` → Redirect إلى اللوح

## 8) Unified Login Group

1. `/login` — الحي
2. `/driver-login` · `/service-provider-login` · `/driver-register` · `/delivery/login.html` — Redirect
3. `/admin-login` — مستقل عن قصد
4. `/partner-portal` — فهرس تسجيل
5. `/register-store` — تكملة متجر

## 9) Cart / Checkout Group

1. `/checkout` — رسمي
2. `/cart` — Redirect
3. `/cart.html` — صفحة حية مكررة
4. `POST /api/checkout` — API مكررة deprecated
5. `/order` — إنشاء قديم

## 10) Customer Discovery Hubs Group

1. `/restaurants` ↔ `/preview/restaurants-hub.html`
2. `/stores` ↔ `/preview/stores-hub.html`
3. `/services` ↔ `/preview/services-hub.html`
4. `/delivery-services.html` ↔ `/preview/delivery-hub.html`
5. `/` ↔ `/preview/home-hub-direct.html`
6. `/browse` مع القوائم الحية

## 11) Wallet Surfaces Group

1. `/wallet` (عميل)
2. `#wallet` تاجر / مندوب / خدمة / نقل
3. `/driver-wallet`
4. `/store-dashboard` محفظة
5. `/api/wallet` vs `/api/store/wallet` vs `/api/driver/wallet` vs `/api/finance/wallet`

## 12) Notifications Group

1. `/notifications`
2. جرس `notification-center.js` في الهيدر
3. أقسام `#notifications` في كل Preview

## 13) Customer Order Follow-up Group

1. `/my-orders`
2. `/track`
3. `/order` (إنشاء لا متابعة)
4. `/delivery/map.html` → track

## 14) Customer Home Group (مُغلق كواجهات، مفتوح كـRedirect)

1. `/` — الحي
2. `/start-now` · `/dashboard` · `/customer-preview` — Redirect إلى `/`

---

# User Journey Map

هل ينتقل المستخدم بين أكثر من Portal أو تصميم؟ نعم في كل دور شريك.

### Customer

```
Home `/`
  → Browse `/restaurants` | `/stores` | `/services` | `/delivery-services.html`
  → Store `/store`  أو  Gas `/gas-delivery`  أو  Book `/service-book`  أو  Map `/delivery-map`
  → Draft (localStorage)
  → Cart `/checkout`   [مسار بديل حي: `/cart.html`]
  → OTP على `/login` أو داخل checkout
  → Order created `POST /api/order/create`
  → Track `/track?id=`
  → My Orders `/my-orders`
  → Wallet `/wallet`
  → Notifications `/notifications` أو جرس الهيدر
```

تصميم واحد تقريباً (guest-shell) بعد توحيد المنزل إلى `/`. لا ينتقل لبوابة Preview.

### Merchant

```
Login `/login?role=store`
  → OTP `/api/core/*`
  → Dashboard `/merchant-preview`          ← تصميم Portal 2.0
  → Orders `#orders`  أو يقفز إلى `/order-board` (تصميم كلاسيكي store-shell)
  → Products `#products`  أو `/store-dashboard` (كلاسيكي)
  → Ready / status عبر `#orders` أو order-board أو merchant-dashboard
  → Wallet `#wallet` / `#withdrawals`  أو store-dashboard#walletAnchor
```

**ينتقل بين تصميمين:** Portal 2.0 و store-shell الكلاسيكي في نفس الجلسة إذا اتبع روابط order-board / store-dashboard / merchant-dashboard.

تسجيل متجر جديد: `/login?mode=register&role=store` → `/register-store` → `/pending-approval.html` → بعد الاعتماد `/merchant-preview`.

### Driver

```
Login `/login?role=driver`   [روابط قديمة تُحوَّل]
  → `/driver-preview`                         ← Portal 2.0
  → Available: `#ready`  أو `/orders`         ← تصميم آخر
  → Accept `/api/driver/accept/:id`
  → Pickup (غير منفصل في UI)
  → Deliver `#active` / `#live-track`  أو `/driver-app` أو `/driver.html`
  → Complete
  → Wallet `#wallet`  أو `/driver-wallet`
```

**ينتقل بين أربعة تصاميم** إذا استخدم هيدر `driver-nav`: Preview · orders.html · driver-app · driver.html.

### Service Provider

```
Login `/login?role=service`
  → `/service-preview`                        ← Portal 2.0
  → Requests `#requests`
  → Accept / Reject / En route / Start / Complete
  → Schedule `#schedule`
  → Wallet `#wallet`
```

مسار بديل حي: `/services-provider` (تصميم كلاسيكي مختلف). الأسماء القديمة Redirect إليه لا إلى Preview.

إن كان `service_type` نقل:

```
Login → `/transport-preview` → transport-orders → fleet/pricing → wallet
```

### Admin

```
Admin Login `/admin-login`   (معزول عن `/login`)
  → Dashboard `/admin-dashboard`
  → Operations: ألواح Orders / Drivers / Stores / Approvals / Services / Transport
  → Finance: financePanel و/أو `/admin-finance` · `/admin/withdrawals` · `/admin-debts`
  → Users: Customers / Drivers / Providers
  → Settings: panelSettings و/أو `/admin-settings` · `/admin/branding` · `/admin/categories`
```

**ينتقل بين الكونسول المعياري وأقمار HTML** من الهيدر. مسار ثالث إن فُتح `/admin-dashboard.html` يدوياً.

---

# APIs حسب المجال (مرجع سريع)

| المجال | Mount | ملاحظات |
| --- | --- | --- |
| Core / OTP / banners | `/api/core` | الدخول الموحّد |
| Order unified | `/api/order` | `create` المعتمد |
| Checkout legacy | `/api/checkout` | deprecated |
| Store / merchant | `/api/store` و `/api/stores` | نفس الراوتر |
| Driver | `/api/driver` | يشمل OTP قديم غير مستدعى من UI |
| Services | `/api/services` | خدمة + نقل |
| Delivery | `/api/delivery` | خريطة + شكاوى + إنشاء قديم |
| Wallet | `/api/wallet` | ledger + topup + withdraw OTP |
| Finance parallel | `/api/finance` | عمولة / refund / wallet ثانية |
| Pay debts | `/api/pay` | `/pay` HTML |
| Admin | `/api/admin` + `/api/admin/auth` + `/api/admin/settings` | |
| Notifications | `/api/notifications` | |
| Invoice | `/api/invoice/:id` | من `/track` |
| Categories public | `/api/categories` | |
| WhatsApp webhook | `/api/whatsapp` | لا صفحة |
| Test | `/api/test/commission/:id` | Lab API |
| Food | `/api/food` | لا صفحة HTML في الجرد |
| Market | `/api/market` | لا صفحة HTML في الجرد |

حماية الصفحات HTML: لا middleware دور. حراسة JS انتقائية.

---

# Final Summary

منهج العد: صف واحد في الجدول الرئيسي = مسار فريد. زوج `.html` لنفس المعالج = 1 إلا إذا اختلف السلوك (`/driver` مقابل `/driver.html`). الأرقام تطابق عمود الحالة في الجدول.

| المؤشر | العدد |
| ---: | ---: |
| إجمالي Routes المفهرسة في الجدول | **83** |
| صفحات Production (بما فيها الأقمار الإدارية `/order-board` و `/admin/withdrawals` و branding و categories) | **37** |
| صفحات Legacy حية (تُفتح وتعمل وقد تكون مستخدمة) | **16** |
| Redirects (سيرفر أو HTML فوري) | **22** |
| Test / Lab | **7** |
| Orphan (ملف بلا استخدام حي) | **1** (`/erwenow.html`) + APIs بلا UI (`/api/food` · `/api/market` · OTP المندوب القديم) |
| مجموعات الازدواجية الموثّقة أعلاه | **14** |
| صفحات تؤدي نفس الوظيفة أو متقاربة جداً (داخل المجموعات 1–9 و 11–12 أساساً) | **≈ 38** سطحاً داخل عناقيد |
| صفحات لا يوجد لها استخدام حي كواجهة مستخدم | **30** (Redirect 22 + Orphan 1 + Lab 7) |

## Top 10 Duplications

أخطر 10 حالات ازدواجية في ERVENOW اليوم (بلا توصية تنفيذ):

1. **تاجر — أربعة منازل تشغيل:** `/merchant-preview` + `/store-dashboard` + `/merchant-dashboard` + `/order-board`. نفس التاجر ينتقل بين Portal 2.0 و store-shell. المنتجات والطلبات والمحفظة مكررة بفروق IBAN/مخزون/كانبان.
2. **مندوب — أربع منظومات موازية:** `/driver-preview` + `/driver.html` (static رغم Redirect `/driver`) + `/orders` (API قائمة مختلفة) + `/driver-app` (`ping-arrival` فريد). الطلب الجديد والحالي والخريطة موزعة.
3. **مزوّد خدمة — Preview الرسمي مقابل كلاسيكي ما زال هدف Redirects القديمة:** `/service-preview` حي؛ `/service-dashboard` و `/provider-dashboard` يذهبان إلى `/services-provider` لا إلى المنزل الرسمي.
4. **أدمن — كونسولان:** `/admin-dashboard` (معياري) مقابل `/admin-dashboard.html` (مونوليث static). Login يفتح الأول؛ الثاني يُفتح بالرابط المباشر.
5. **سلة مزدوجة:** `/checkout` المعتمد + `/cart.html` القادر على `POST /api/order/create` رغم أن `/cart` يُحوَّل. إضافة `POST /api/checkout` deprecated.
6. **محافظ متعددة لنفس الرصيد حسب الدور:** `/wallet` · `#wallet` في أربع بوابات · `/driver-wallet` · محفظة store-dashboard · أربعة mounts API (`wallet` / `store/wallet` / `driver/wallet` / `finance/wallet`).
7. **مالية الأدمن خمسة أسطح:** financePanel + `/admin-finance` + `/admin-debts` + `/admin/commissions` + `/admin/withdrawals`.
8. **دخول موحّد في UI مع بقاء APIs قديمة:** الصفحات Redirect إلى `/login` لكن `/api/driver/send-otp` و `/api/driver/register` ما زالا في الخادم. `/admin-login` مستقل مشروع.
9. **نقل كوضع خدمة مع طابور كلاسيكي مشترك:** `/transport-preview` مستقل شكلاً ويعيد استخدام `/api/services`؛ `/services-provider` قد يعرض نفس الحجوزات.
10. **إشعارات بثلاثة سطوح + هُب تصميم تكرر الاكتشاف:** `/notifications` + جرس الهيدر + `#notifications` في Preview؛ و `/preview/*-hub` تكرر `/restaurants|/stores|/services|/delivery-services|/`.

---

## فجوات ليست ازدواجية (لا UI اليوم)

- ساعات عمل المتجر
- زر فتح/إغلاق المتجر في لوحة التاجر
- دفتر عناوين عميل مستقل عن checkout
- حالة مندوب متاح/غير متاح كإعداد تشغيل
- خطوة استلام مستقلة عن قبول المندوب
- POS التاجر (عنصر قائمة فقط)

---

**لم يُنفَّذ أي حذف أو دمج أو Redirect في هذا الجرد.** الخريطة تصف المنصة كما هي في 22 سبتمبر 2026.
