# ERVENOW — Portal Audit Report

> Generated: 2026-06-17  
> Scope: البوابات التشغيلية الأربع (Merchant · Driver · Service · Transport)  
> المصدر: `public/assets/*-preview.js` · `portal-framework/` · APIs في `apps/store` · `apps/driver` · `apps/services`

---

## ملخص تنفيذي

| البوابة | المسار الرسمي | حالة الإطلاق (`portalLaunch`) | البوابة الكلاسيكية (تشغيل فعلي اليوم) |
| ------- | ------------- | ----------------------------- | ------------------------------------- |
| **Merchant** | `/merchant-preview` | `live: false` — معاينة draft | `/store-dashboard` · `/order-board` |
| **Driver** | `/driver-preview` | `live: false` — معاينة draft | `/driver` · `/driver-app` |
| **Service** | `/service-preview` | `live: true` | `/services-provider.html` |
| **Transport** | `/transport-preview` | `live: true` | `/services-provider.html` (نفس اللوحة، مفلترة) |

الهيكل الموحّد: **Portal Framework** (`portal-shell.js` + `role-context.js` + `portal-widgets.js`).

```
┌─────────────────────────────────────────────────────────────┐
│  Banner (معاينة / Portal 2.0)                               │
├──────────┬──────────────────────────────────────────────────┤
│ Sidebar  │  Header: ERVENOW · عنوان البوابة · 🔔 · 💳 · ☰  │
│ (قائمة)  ├──────────────────────────────────────────────────┤
│          │  KPI Grid · بطاقات · جداول · أزرار إجراء          │
│          │                                                  │
│ Foot:    │  (جوال) Bottom Nav — Driver/Service/Transport    │
│ كلاسيكية │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

---

## 1. ERVENOW Merchant (`/merchant-preview`)

### 1.1 مخطط الصفحة الرئيسية (Dashboard)

| المنطقة | المكوّن | الوصف |
| ------- | ------- | ----- |
| **هيدر** | `PortalHeader` | شعار ERVENOW · «بوابة المتجر» · جرس إشعارات · محفظة · قائمة ☰ |
| **شريط الحالة** | `toolsHtml` | حبة 🟢 نشط / ⏸ موقوف من `store.status` |
| **KPI Grid** | 6 بطاقات | طلبات اليوم · مبيعات اليوم · الرصيد · التقييم · المنتجات · الطلبات النشطة |
| **بطاقة اختصارات** | 3 روابط | Order Board · Store Dashboard · Merchant Dashboard الكلاسيكية |
| **قائمة جانبية** | 11 عنصر | انظر §1.4 |
| **Bottom Nav** | معطّل | `showBottomNav: false` |

### 1.2 شرح البطاقات (Dashboard)

| البطاقة | الوظيفة | مصدر البيانات | هل تعمل؟ |
| ------- | ------- | ------------- | -------- |
| طلبات اليوم | عدد طلبات اليوم | `GET /api/store/merchant-dashboard` → `orders` | ✅ |
| مبيعات اليوم | مجموع `order_total` لليوم | نفس المصدر (حساب عميل) | ✅ |
| الرصيد | رصيد المحفظة | `dashboard.wallet.balance` | ✅ |
| التقييم | متوسط التقييم | `dashboard.store.average_rating` | ✅ إن وُجد |
| المنتجات | عدد المنتجات النشطة | `aggregates.products_active_count` أو `products.length` | ✅ |
| الطلبات النشطة | جديد + تجهيز + جاهز | `order-board` / dashboard orders | ✅ |

### 1.3 أقسام أخرى (Sidebar)

| القسم | الوظيفة | API / مصدر | الحالة |
| ----- | ------- | ---------- | ------ |
| **الطلبات** | تبويبات جديد/تجهيز/جاهز/مكتمل + إجراءات workflow | `order-board` + `PATCH /api/order/:id/status` | ✅ يعمل |
| **المنتجات** | CRUD منتجات | `GET/POST/PUT/DELETE /api/store/products` | ✅ يعمل |
| **الفئات** | — | في القائمة فقط | ❌ **لا يوجد `renderSection`** — شاشة فارغة |
| **العروض** | منتجات بـ `offer_price` | من `products` | ✅ عرض فقط (التعديل من المنتجات) |
| **المحفظة** | رصيد + آخر 30 عملية | `merchant-dashboard` | ✅ عرض؛ السحب → رابط كلاسيكي |
| **السحوبات** | — | في القائمة فقط | ❌ **لا يوجد قسم** — شاشة فارغة |
| **التقارير** | KPI حسب اليوم/أسبوع/شهر | فلترة `dashboard.orders` عميلياً | ✅ جزئي (لا تقارير مالية متقدمة) |
| **الإشعارات** | رابط لـ `/notifications` | لا يُعرض داخل البوابة | ⚠️ إعادة توجيه فقط |
| **الإعدادات** | عرض بيانات المتجر + روابط تعديل | `my-store` + روابط `store-dashboard` | ✅ عرض؛ التعديل خارج البوابة |
| **الكاشير (POS)** | — | — | 🔶 **Placeholder** «Coming Soon» |

### 1.4 القائمة الجانبية

| العنصر | الوظيفة | الحالة |
| ------ | ------- | ------ |
| لوحة التحكم | Dashboard KPIs | ✅ |
| الطلبات | Order workflow | ✅ |
| المنتجات | Catalog CRUD | ✅ |
| الفئات | إدارة أقسام المنتجات | ❌ غير مبنية |
| العروض | عرض العروض | ✅ |
| المحفظة | رصيد وحركات | ✅ |
| السحوبات | طلبات سحب | ❌ غير مبنية |
| التقارير | تقارير مبسطة | ✅ جزئي |
| الإشعارات | → `/notifications` | ⚠️ خارجية |
| الإعدادات | ملف المنشأة | ✅ جزئي |
| الكاشير | POS | 🔶 Placeholder |
| Foot: لوحة المتجر | → `/store-dashboard` | ✅ كلاسيكية |
| Foot: Order Board | → `/order-board` | ✅ كلاسيكية |

### 1.5 Flow Separation

| المحرك | الحالة | ملاحظات |
| ------ | ------ | ------- |
| **Order Routing** | ✅ | طلبات المتجر `portal_type=merchant` عبر store APIs |
| **Notification Routing** | ✅ | أحداث `merchant.*` عبر `notificationEvents` |
| **Wallet Routing** | ✅ | سحوبات المتجر عبر `store_withdrawals` |
| **تسرب بوابات** | ✅ منخفض | APIs مقيّدة بـ `store_id` / دور التاجر |

### 1.6 وصف بصري (Dashboard)

```
[Banner: معاينة — غير جاهزة للإطلاق]
┌─Sidebar────────┐ ┌─Header: ERVENOW Merchant · 🔔 · 💳 ─────────┐
│ 📊 لوحة التحكم │ │  [اسم المتجر]  🟢 نشط                      │
│ 📦 الطلبات     │ ├────────────────────────────────────────────┤
│ 🛍 المنتجات    │ │  📦 طلبات اليوم │ 💰 مبيعات │ 💳 رصيد    │
│ ...            │ │  ⭐ تقييم │ 🛍 منتجات │ 🔥 نشطة          │
│                │ │  [اختصارات → لوحات كلاسيكية]               │
└────────────────┘ └────────────────────────────────────────────┘
```

---

## 2. ERVENOW Driver (`/driver-preview`)

### 2.1 مخطط Dashboard

| المنطقة | المكوّن |
| ------- | ------- |
| **هيدر** | اسم المندوب · 🟢 متصل/غير متصل · 🔔 ops · 💳 |
| **KPI** | جديدة · نشطة · مكتملة اليوم · أرباح اليوم · رصيد · تقييم |
| **كتل** | طلبات متاحة (3) · نشطة (3) · مكتملة (3) |
| **Bottom Nav** | طلبات · محفظة · إشعارات · حساب |

### 2.2 البطاقات

| البطاقة | الوظيفة | مصدر | يعمل؟ |
| ------- | ------- | ---- | ----- |
| طلبات جديدة | `ready_queue.length` | `GET /api/driver/orders` | ✅ |
| طلبات نشطة | `active.length` | نفس المصدر | ✅ |
| مكتملة اليوم | فلتر `completed` لليوم | نفس المصدر | ✅ |
| أرباح اليوم | مجموع credits من المحفظة | `wallet.last_transactions` | ⚠️ تقديري |
| الرصيد | رصيد المندوب | `GET /api/driver/wallet` | ✅ |
| التقييم | متوسط | `GET /api/driver/rating` | ✅ |

### 2.3 الأقسام

| القسم | API | إجراءات | الحالة |
| ----- | --- | ------- | ------ |
| **الطلبات الجاهزة** | `driver/orders` → `ready_queue` | `POST /api/driver/accept/:id` | ✅ |
| **الطلبات النشطة** | `active` | start-delivery · complete · تتبع حي | ✅ |
| **المكتملة** | `completed` | عرض فقط | ✅ |
| **الأرباح** | wallet tx + completed count | فلتر زمني | ⚠️ تقديري |
| **المحفظة** | `driver/wallet` | رابط `/driver-wallet` للسحب | ✅ |
| **التقييم** | `driver/rating` | عرض | ✅ |
| **الإشعارات** | — | رابط `/notifications` | ⚠️ خارجية؛ الهيدر يستخدم `PortalNotificationsOps` | ✅ جزئي |
| **الإعدادات** | `core/me` | عرض الملف | ✅ |

**PortalNotificationsOps (الهيدر):** بطاقات إشعار مع زر «قبول/استلام» → `onAcceptOrder` → `driver/accept`.

### 2.4 Flow Separation

| المحرك | الحالة |
| ------ | ------ |
| Orders | ✅ `filterOrdersForPortal(..., "driver")` في `driver/routes` |
| Notifications | ✅ `driver.*` events · ops bell |
| Wallet | ✅ `ervenow_withdraw_requests` + ledger `driver` |
| تسرب | ✅ منخفض — لا يعرض طلبات service/transport |

### 2.5 وصف بصري

```
[Banner: معاينة draft]
┌─Sidebar──┐ ┌─ Header · 🟢 متصل · 🔔 · 💳 ─────────────┐
│ 🟢 جاهزة  │ │ KPI: جديد │ نشط │ مكتمل │ أرباح │ رصيد  │
│ 🚚 نشطة   │ │ ┌─ طلبات متاحة ─┐ ┌─ نشطة ─┐ ┌─ مكتملة ┐│
│ ...       │ │ │ [بطاقة+قبول] │ │ ...    │ │ ...     ││
└───────────┘ └──────────────────────────────────────────┘
[Bottom Nav: طلبات | محفظة | 🔔 | حساب]
```

---

## 3. ERVENOW Service (`/service-preview`)

### 3.1 مخطط Dashboard

| المنطقة | المكوّن |
| ------- | ------- |
| **Banner** | «بوابة الخدمات — Portal 2.0» (بدون draft) |
| **هيدر** | بوابة الخدمات · 🔔 ops (حجز) · 💳 |
| **KPI** | جديدة · جارية · مكتملة · تقييم · رصيد · أرباح اليوم |
| **كتل** | طلبات جديدة / جارية / مكتملة (حتى 4 لكل كتلة) |
| **Bottom Nav** | طلبات · محفظة · إشعارات · حساب |

### 3.2 البطاقات

| البطاقة | مصدر | يعمل؟ |
| ------- | ---- | ----- |
| طلبات جديدة | `stats.new_orders` أو `filterBookings("new")` | ✅ |
| طلبات جارية | `stats.active_jobs` | ✅ |
| مكتملة | `stats.completed_jobs` | ✅ |
| التقييم | `stats.rating_avg` · `rating_count` | ✅ |
| الرصيد | `stats.wallet_balance_sar` | ✅ |
| أرباح اليوم | `stats.wallet_earned_sar` | ⚠️ إجمالي مكتسب وليس «اليوم» فقط |

### 3.3 الأقسام

| القسم | API | إجراءات | الحالة |
| ----- | --- | ------- | ------ |
| **الطلبات (Requests)** | `GET /api/services/me/dashboard` | حجز · تم التنفيذ | ✅ |
| **الجدولة (Schedule)** | — | — | 🔶 **Coming Soon** |
| **المحفظة** | stats + `GET /api/wallet/transactions` | رابط `/wallet.html` | ✅ |
| **التقييم** | من `users.service_rating_*` | عرض | ✅ |
| **الإشعارات** | `PortalNotificationsOps` + `/notifications` | حجز من الجرس | ✅ |
| **الإعدادات** | profile من dashboard | روابط كلاسيكية | ✅ |

**فصل Service/Transport:** `isServiceProfile()` يمنع حسابات `pickup_truck` من الدخول — يُوجّه لـ `/transport-preview`.

### 3.4 Flow Separation

| المحرك | الحالة |
| ------ | ------ |
| Orders | ✅ `filterOrdersForPortal(bookings, portalRole)` + `applyServiceTypeFilter` |
| Notifications | ✅ `service.*` · ops `onReserveBooking` |
| Wallet | ✅ ledger role `service` |
| تسرب | ⚠️ **منخفض–متوسط** — نفس API للخدمة والنقل؛ الفصل عبر `portalRole` + `service_type` |

### 3.5 وصف بصري

```
[Banner: Portal 2.0]
┌─Sidebar──┐ ┌─ KPI 6 بطاقات ─────────────────────────────┐
│ 📋 طلبات  │ │ [طلبات جديدة — بطاقة حجز]                 │
│ 📅 جدولة  │ │ [طلبات جارية — تم التنفيذ]                  │
│ 💳 محفظة  │ │ [مكتملة]                                   │
└───────────┘ └────────────────────────────────────────────┘
```

---

## 4. ERVENOW Transport (`/transport-preview`)

### 4.1 مخطط Dashboard

| المنطقة | المكوّن |
| ------- | ------- |
| **Banner** | «بوابة النقل — Portal 2.0» |
| **KPI** | جديدة · جارية · مكتملة · أرباح اليوم · رصيد · تقييم |
| **فلاتر نوع** | chips: الكل · سطحة · توصيل داخلي · أثاث · غاز |
| **كتلة** | طلبات متاحة للحجز (5) |

### 4.2 البطاقات

نفس منطق Service مع `filterBookings` + `matchesTypeFilter` + `typeLabel`.

### 4.3 الأقسام

| القسم | الحالة |
| ----- | ------ |
| **طلبات النقل** | ✅ حجز/إتمام — نفس APIs الخدمة |
| **المحفظة** | ✅ |
| **الإشعارات** | ✅ ops + `/notifications` |
| **الأسطول (Fleet)** | 🔶 **Coming Soon** |
| **التسعير (Pricing)** | 🔶 **Coming Soon** |
| **الإعدادات** | ✅ + بيانات المركبة إن وُجدت |

### 4.4 Flow Separation

| المحرك | الحالة | ملاحظة |
| ------ | ------ | ------- |
| Orders | ✅ | `portal_type=transport` + فلتر أنواع النقل |
| Notifications | ✅ | `transport.*` events |
| Wallet | ⚠️ | يستخدم ledger `service` role (نفس محفظة مزود الخدمة) |
| تسرب | ⚠️ | `gas_delivery` مُصنّف ضمن أنواع النقل في الواجهة — قد يظهر في Transport وService |

### 4.5 وصف بصري

```
[Banner: Portal 2.0]
┌─Sidebar──────────┐ ┌─ Chips: الكل | سطحة | داخلي | أثاث | غاز ─┐
│ 🚚 طلبات النقل   │ │ KPI + [بطاقات نقل: من→إلى · حجز]            │
│ 🚛 الأسطول       │ └─────────────────────────────────────────────┘
│ 💲 التسعير       │
└──────────────────┘
```

---

## 5. البطاقات غير المكتملة — ملخص

| البوابة | العنصر | النوع | التوصية |
| ------- | ------ | ----- | ------- |
| Merchant | الفئات (sidebar) | قائمة بلا محتوى | **استكمال** أو **إخفاء** حتى الجاهزية |
| Merchant | السحوبات (sidebar) | قائمة بلا محتوى | **استكمال** (ربط `store-dashboard#withdraw`) أو **إخفاء** |
| Merchant | POS | Placeholder | **إخفاء** حتى Platform Modules · أو ربط `ervenow_pos` |
| Merchant | الإشعارات (قسم) | Redirect فقط | **إبقاء** مع تحسين in-app لاحقاً |
| Driver | الأرباح | تقدير من tx | **استكمال** endpoint أرباح يومية |
| Driver | الإشعارات (قسم) | Redirect | **إبقاء** — ops bell يعمل |
| Service | الجدولة | Coming Soon | **إخفاء** من القائمة أو **استكمال** مع `PATCH /order/:id/details` |
| Transport | Fleet | Coming Soon | **إخفاء** أو تأجيل |
| Transport | Pricing | Coming Soon | **إخفاء** أو تأجيل |
| Transport | غاز في فلاتر النقل | تصنيف مشترك | **مراجعة** — نقل الغاز لـ Service فقط |

---

## 6. جدول الجاهزية الموحّد

| البوابة | جاهزة للتشغيل | تحتاج تطوير | Placeholder / فارغ |
| ------- | ------------- | ------------ | ------------------- |
| **Merchant** | الطلبات · المنتجات · المحفظة (عرض) · التقارير البسيطة · الإعدادات (عرض) | الفئات · السحوبات · إشعارات in-app · إطلاق live | POS · قسما الفئات/السحوبات الفارغان |
| **Driver** | الطلبات (قبول/توصيل) · المحفظة · التقييم · ops notifications | الأرباح الدقيقة · إطلاق live | قسم إشعارات (redirect) |
| **Service** | الطلبات · المحفظة · التقييم · ops notifications | جدولة المواعيد | Schedule (Coming Soon) |
| **Transport** | الطلبات · المحفظة · ops notifications | Fleet · Pricing · تصنيف غاز | Fleet · Pricing |

**تصنيف عام:**

| الحالة | العدد |
| ------ | ----- |
| أقسام تعمل بالكامل | ~22 |
| أقسام جزئية / روابط خارجية | ~8 |
| Placeholder / شاشة فارغة | ~7 |

---

## 7. التوصيات قبل Meshwar

### 7.1 يجب استكماله فوراً (قبل أي وحدة جديدة)

1. **إصلاح عناصر القائمة الفارغة في Merchant** — إما بناء `categories` + `withdrawals` أو إزالتها من `merchant.json` / `role-context.js`.
2. **توحيد مسار الإنتاج** — تحديد: هل التجار والمناديب يبقون على اللوحات الكلاسيكية حتى `live: true`؟ تحديث `portalLaunch.json` و`login` destinations وفقاً لذلك.
3. **إخفاء Placeholders من القائمة** — POS · Fleet · Pricing · Schedule (أو ربطها بـ Platform Modules `disabled/beta`).
4. **مراجعة تصنيف `gas_delivery`** — هل يظهر في Transport أم Service فقط؟
5. **تفعيل فلتر الإشعارات في `/notifications`** بـ `target_portal` عند فتح البوابة (تأكيد من الواجهة).

### 7.2 يمكن تأجيله

- تقارير Merchant المتقدمة · Fleet · Pricing · POS الكامل.
- Bottom Nav لـ Merchant.
- جدولة Service الكاملة (حتى اكتمال واجهة تعديل الموعد للعضو).

### 7.3 يجب حذفه (من القائمة الظاهرة)

- عناصر sidebar بلا `renderSection` (فئات/سحوبات Merchant) — **حذف مؤقت من القائمة** أفضل من شاشة فارغة.
- أقسام «Coming Soon» من القائمة الرئيسية — نقلها لـ Platform Modules.

### 7.4 أولوية قبل Meshwar

| # | المهمة | السبب |
| - | ------ | ----- |
| 1 | إغلاق فجوات Merchant sidebar | تجربة مكسورة للتاجر |
| 2 | اعتماد Portal Launch (merchant/driver `live`) | توجيه ما بعد تسجيل الدخول |
| 3 | Platform Modules Foundation (POS · Meshwar flags) | Meshwar يُفعّل من الأدمن لا من كود |
| 4 | اختبار E2E Flow Separation لكل بوابة | طلب → إشعار → محفظة |
| 5 | **ثم** Meshwar Preparation | حسب خارطة الطريق المعتمدة |

---

## 8. مراجع الكود

| مكوّن | المسار |
| ----- | ------ |
| تكوين البوابات | `public/assets/portal-framework/configs/*.json` |
| Merchant UI | `public/assets/merchant-preview.js` |
| Driver UI | `public/assets/driver-preview.js` |
| Service UI | `public/assets/service-preview.js` |
| Transport UI | `public/assets/transport-preview.js` |
| Shell | `public/assets/portal-framework/portal-shell.js` |
| إطلاق البوابات | `shared/utils/portalLaunch.js` · `data/portal-launch.json` |
| Order filter | `shared/utils/orderPortalRouting.js` |
| Notification filter | `shared/utils/notificationPortalRouting.js` |
| Wallet filter | `shared/utils/walletPortalRouting.js` |

---

## 9. اختبار يدوي مقترح

```text
Merchant  → /merchant-preview  (حساب store معتمد) → طلبات → قبول → محفظة
Driver    → /driver-preview    (حساب driver)        → جاهزة → قبول → تسليم
Service   → /service-preview   (سباك/كهربائي)     → حجز → إتمام
Transport → /transport-preview (pickup_truck)     → حجز سطحة → إتمام
```

تحقق من: عدم ظهور طلبات بوابة أخرى · إشعار واحد لكل حدث · رصيد محفظة يتحدث بعد التسليم.
