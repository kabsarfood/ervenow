# تحليل توحيد بوابة التاجر — 2026-09-29

مرحلة التحليل فقط. لا حذف، لا Redirect نهائي، لا تغيير RLS.

## 1) خريطة الصفحات الحالية

| المسار | الملف | الدور الفعلي اليوم |
|---|---|---|
| `/merchant-preview` | `public/merchant-preview.html` + `merchant-preview.js` + PortalShell | **البوابة التشغيلية الحقيقية** (Sidebar + hash + POS + طلبات + محفظة + موظفين) |
| `/merchant-dashboard` | `public/merchant-dashboard.html` | صفحة تقارير رفيعة: KPI + جدول طلبات + إيداعات |
| `/order-board` | `public/order-board.html` + `order-board.js` | لوحة تشغيل الطلبات (عدّادات، بطاقات، مودال، طباعة، خريطة) |
| `/store-dashboard` و `/store-panel` | `public/store-dashboard.html` | لوحة قديمة شاملة: بروفايل، منتجات، محفظة `#walletAnchor`، سحب، موقع |
| `/store.html?id=&preview=1` | `public/store.html` + `store-preview-mode.js` | **واجهة العميل** مع شريط معاينة — ليست إدارة |
| `/restaurant-dashboard` | Redirect 302 → `/store-dashboard` | مسار قديم |

دخول التاجر الرسمي في التوجيه (`role-routing.js`): **`/merchant-preview`** وليس `/merchant-dashboard`.

## 2) وظيفة كل صفحة

### `/order-board`
- حماية واجهة: `ErvenowAuthGuard` + `login?role=store`
- قراءة: `GET /api/store/order-board`
- تحديث الحالة: `PATCH /api/order/:id/status` عبر `merchant-order-workflow.js`
- حي: Socket.IO `order:patch`
- فلاتر عدّادات: جديد / مقبول / تجهيز / جاهز / مع المندوب / مُسلّم
- أزرار: قبول، بدء التجهيز، جاهز، طباعة فاتورة 80مم، بيانات المندوب، تفاصيل، تتبع
- لا يوجد زر رفض طلب في هذه الصفحة
- لا بحث نصي ولا فلتر تاريخ (هذان موجودان في merchant-preview)

### `/merchant-dashboard`
- حماية واجهة: نفس الحارس
- قراءة: `GET /api/store/merchant-dashboard` فقط (مرة عند التحميل + debounce 400ms على socket)
- أزرار حالة الطلب في الجدول (نفس workflow)
- روابط تخرج إلى: order-board، merchant-preview، store-dashboard#walletAnchor، store.html معاينة

### `/store-dashboard#walletAnchor` وما حوله
- `GET /api/store/my-store` و `GET /api/store/merchant-dashboard`
- محفظة: رصيد + حركات من نفس dashboard
- سحب: `GET/POST /api/store/withdrawals`
- منتجات: `GET/POST/PUT/DELETE /api/store/products`
- أقسام خيارات: `GET /api/store/product-category-options`
- بروفايل: `PATCH /api/store/merchant-hub` (شعار، غلاف، وصف، طرق دفع)
- موقع: `PATCH /api/store/location`
- تقييمات: `GET /api/store/reviews`
- لا Socket؛ تحديث يدوي

### `/store.html?id=...&preview=1`
- كتالوج عام: `GET /api/store/:id` و `GET /api/store/products` و reviews
- `preview=1` يخفي تنقّل الزائر ويعيد الشعار لـ `/merchant-preview`
- **تبقى صفحة عميل. لا تُدمج داخل الإدارة.**

### `/merchant-preview` (يجب إدخاله في الدمج وإلا تُفقد وظائف)
أقسام hash الحالية: `dashboard`, `orders`, `pos`, `store-admin`, `products`, `categories`, `offers`, `reviews`, `visitor-preview`, `wallet`, `withdrawals`, `expenses`, `reports`, `notifications`, `settings`

وظائف إضافية غير موجودة في الصفحات الأربع المطلوبة حرفياً:
- كاشير POS كامل (`merchant-pos.js` → `POST /api/store/pos-orders`)
- موظفو كاشير (`GET/POST/PATCH /api/store/cashiers`) — الدور ثابت `cashier`
- مصروفات (`/api/store/expenses`)
- تقارير من بيانات محلية (طلبات + مصروفات) بدون endpoint تقارير جديد
- نشر المتجر (`GET /api/store/publish-readiness`, `POST /api/store/publish`)
- إعداد POS (`GET/PATCH /api/store/pos-settings`)
- بحث طلبات + تاريخ يوم (`/api/store/order-board?date=`)
- شريط طلب وارد + polling 45 ثانية **عند إخفاء التبويب يُوقف** + socket
- تقييمات، عروض (سعر عرض على المنتج)

## 3) الوظائف المتكررة

| الوظيفة | أين تتكرر |
|---|---|
| قائمة الطلبات + تغيير الحالة | order-board، merchant-dashboard، merchant-preview#orders |
| `GET /api/store/merchant-dashboard` | merchant-dashboard، store-dashboard، merchant-preview، store-shell (رصيد الهيدر)، guest-shell، cart |
| رصيد المحفظة والحركات | store-dashboard#walletAnchor، merchant-dashboard، merchant-preview#wallet |
| طلب سحب | store-dashboard، merchant-preview#withdrawals |
| منتجات CRUD | store-dashboard#productsAnchor، merchant-preview#store-admin |
| شعار/غلاف/وصف | store-dashboard#brandingAnchor، merchant-preview#settings |
| موقع المتجر | store-dashboard، merchant-preview#settings |
| معاينة العميل | كل الصفحات تقريباً → store.html?preview=1 |
| إشعارات الهيدر | store-shell + merchant-preview notification-center |

## 4) ماذا ننقل / ماذا نبقي

ننقل إلى `/merchant-dashboard` كـ **نفس PortalShell** (لا إعادة بناء):
- محتوى merchant-preview بالكامل (المصدر الأساسي)
- تشغيل order-board الكامل داخل `#orders` (مودال، طباعة، خريطة، عدّادات) فوق ما يوجد في preview
- محفظة + سحب من store-dashboard و preview → `#wallet`
- منتجات/أقسام/عروض → `#products`
- هوية المتجر + ساعات إن وُجدت لاحقاً → `#store` (حالياً لا يوجد نموذج ساعات عمل في الكود)
- POS كما هو → `#pos` (لا مسار POS مستقل؛ يُركَّب داخل البوابة)
- كاشير موظفين → `#employees` (نفس cashiers، بدون تغيير نموذج الصلاحيات)
- تقارير موجودة → `#reports`
- إعدادات النشر/POS/الموقع المتبقية → `#settings`

نبقي بدون دمج:
- `store.html` كواجهة عميل + زر «معاينة المتجر»
- ملفات HTML القديمة حتى يثبت الاختبار (ثم Redirect فقط)
- عقود API الحالية
- RLS دون تغيير

لا يوجد في النظام حالياً (لا نخترع):
- ساعات عمل مستقلة
- فتح/إغلاق وردية غير `is_published` / حالة المتجر المعتمد
- رفض طلب من الواجهة (الفلترة تخفي الملغى فقط)
- SKU/Barcode في نموذج store-dashboard؛ يظهران في POS إن وُجدت الحقول على المنتج
- صلاحيات موظفين متعددة الأدوار — الدور دائماً cashier

## 5) APIs المرتبطة (محمية `requireAuth` + `requireStoreRole`)

أدوار مسموحة: `store | merchant | restaurant | admin` — لا توسيع.

قراءة:
- `GET /api/core/me`
- `GET /api/store/my-store`
- `GET /api/store/order-board` و `?date=`
- `GET /api/store/merchant-dashboard`
- `GET /api/store/products?store_id=`
- `GET /api/store/product-category-options`
- `GET /api/store/merchant-categories`
- `GET /api/store/withdrawals`
- `GET /api/store/wallet`
- `GET /api/store/reviews`
- `GET /api/store/publish-readiness`
- `GET /api/store/pos-settings`
- `GET /api/store/cashiers`
- `GET /api/store/expenses`

كتابة:
- `PATCH /api/order/:id/status`
- `POST /api/store/products` · `PUT/DELETE /api/store/products/:id`
- `PATCH /api/store/merchant-hub`
- `PATCH /api/store/location`
- `POST /api/store/withdrawals`
- `POST /api/store/publish`
- `GET/POST/PUT/DELETE /api/store/merchant-categories` (+ reorder)
- `POST/PATCH /api/store/cashiers`
- `PATCH /api/store/pos-settings`
- `POST /api/store/pos-orders`
- `GET/POST/DELETE /api/store/expenses`

عام للمعاينة فقط:
- `GET /api/store/:id` · products · reviews (عميل)

حي:
- Socket `order:patch` / `order:cancelled`

## 6) المخاطر

1. **ازدواج البوابة:** `/merchant-dashboard` اليوم أضعف من `/merchant-preview`. بناء لوحة جديدة فوق dashboard يحذف POS/موظفين/نشر إن لم يُنقل preview أولاً.
2. **توجيه الدخول** ما زال إلى `/merchant-preview` (`OPERATIONAL_PORTAL_PATHS.merchant`). يجب تغييره مع المرحلة الأخيرة فقط.
3. **Hash conflict:** `#wallet` في preview موجود؛ `#walletAnchor` في store-dashboard مختلف. `#home` غير موجود (اليوم `#dashboard`).
4. **Polling مزدوج:** لا تشغّل interval order-board مع interval preview (45ث) معاً.
5. **هيدر store-shell** يشير `#walletAnchor` وقد يكسر الصفحة إن لم يوجد العنصر.
6. **إشعارات** تشير `/merchant-preview#orders` و `#wallet`.
7. **PWA / SW** مربوط بمسار merchant-preview.
8. **`admin` في requireStoreRole** — لا تضيّق دون قرار؛ لا توسّع.
9. جداول HTML في dashboard تضيق على الجوال (عولج جزئياً) — لا تعِد جداول ثقيلة.
10. لا ساعات عمل في الكود — لا تخترع جدولاً أو أعمدة.

## 7) خطة الدمج بالترتيب (تنفيذ لاحق — بعد موافقتك)

1. تثبيت `/merchant-dashboard` كغلاف: نقل PortalShell من merchant-preview إلى هذا المسار (نفس JS، hashBase جديد). بدون Redirect بعد.
2. خريطة hash توافقية: قبول القديم والجديد (`dashboard`≡`home`, `store-admin` يوزَّع، `withdrawals` داخل wallet).
3. تعزيز `#orders` بميزات order-board الناقصة (مودال، طباعة، خريطة، عدّادات) مع بقاء `/order-board` يعمل.
4. تجميع `#store` / `#products` / `#employees` من settings + store-admin + store-dashboard دون API جديد.
5. `#wallet` يضم سحب store-dashboard؛ إخفاء رابط `#walletAnchor` من النوافذ بعد الاختبار.
6. POS كما هو داخل `#pos`.
7. اختبار يدوي لكل قسم + Refresh على الهاش + صلاحية API 401/403.
8. بعدها فقط: Redirect `/order-board` → `#orders`، `/store-dashboard#walletAnchor` → `#wallet`، وتوجيه `portalPathForRole('merchant')` إلى `/merchant-dashboard`. الإبقاء على الملفات حتى فترة تراجع.

لا Redirect في هذه المرحلة.
