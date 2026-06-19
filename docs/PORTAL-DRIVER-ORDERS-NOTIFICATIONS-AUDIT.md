# ERVENOW — Portal Orders & Notifications Audit

**التاريخ:** 17 يونيو 2026  
**النطاق:** Driver Portal (`/driver-preview`) مقابل النظام القديم (`/driver`, `/driver-app`)  
**الهدف:** تحديد نقطة الانقطاع قبل أي قرار معماري جديد

---

## ملخص تنفيذي

| الحكم | الوصف |
|-------|--------|
| **التشخيص الرئيسي** | البوابة والنظام القديم يستدعيان **نفس API** (`GET /api/driver/orders`) — لكن **تجربة التشغيل** تختلف جذرياً |
| **مصدر الحقيقة الفعلي اليوم** | **Legacy Driver** (`/driver`) — تسجيل الدخول يوجّه المندوب إليه، GPS، polling، وصوت |
| **مصدر الحقيقة في الإعدادات** | **Driver Portal** (`driver: true` في `portalLaunch.js`) — **غير مفعّل** في متصفح المستخدم (`role-routing.js`: `driver: false`) |
| **تعيين المندوب** | لا يوجد تعيين تلقائي عند «جاهز» — الإشعار فقط؛ التعيين يحدث عند **قبول** المندوب (`POST /api/driver/accept/:id`) |
| **سبب عدم الظهور في البوابة** | (1) عدم إرسال GPS من البوابة → فلتر «أقرب 3 مناديب» يخفي الطلبات (2) لا polling (3) تجاهل `legacy_open` (4) إشعارات تذهب لأقرب المناديب فقط |

---

## 1. تتبع طلب حقيقي — مسار Merchant Dispatch

```
عضو → إنشاء طلب (store/restaurant)
    ↓
تاجر → preparing → PATCH delivery_status: "ready"
    ↓
unifiedOrderStatus (READY)
    ├─ notifyDriversOrderReady()  → إشعار in-app لأقرب المناديب (driver.order.ready)
    ├─ notifyNearestDrivers()     → واتساب (جدول driver_notifications)
    └─ driver_id يبقى null
    ↓
مندوب يقبل → POST /api/driver/accept/:id
    ├─ إذا ready + merchant → patchUnifiedOrderStatus("picked_up") → driver_id يُسجَّل
    └─ لا يُنشأ driver.task.assigned على هذا المسار
```

### أسئلة التدقيق — Driver Portal

| السؤال | الجواب | الدليل |
|--------|--------|--------|
| هل تم إنشاء الإشعار؟ | **نعم** (لأقرب المناديب فقط) | `unifiedOrderStatus.js` → `notifyDriversOrderReady(sb, order, nearest)` |
| هل تم حفظه؟ | **نعم** في `notifications` | `notificationService.createNotification()` عبر `notifyDriverUser()` |
| هل وصل إلى Driver Portal؟ | **شرطياً** | يظهر في الجرس إذا `recipient_id` = user المندوب **و** `target_portal: "driver"` |
| هل ظهر في Ready Queue؟ | **شرطياً** | فقط إذا المندوب ضمن **أقرب 3** ولديه `lat/lng` في `drivers` |
| هل ظهر في Active Orders؟ | **بعد القبول فقط** | `active` = طلبات `driver_id` = المندوب وحالة accepted/picked/delivering |
| هل ظهر في Completed؟ | **بعد التسليم** | `completed` = `delivery_status: delivered` |

---

## 2. Notification Routing Audit

> **تنبيه تسمية:** الأحداث `driver.order.assigned` و `driver.order.cancelled` **غير موجودة** في الكود.  
> الأسماء الفعلية: `driver.task.assigned` · `driver.order.ready` · `driver.task.cancelled`

### جدول الأحداث

| الحدث (المطلوب) | الحدث الفعلي | يُنشأ؟ | يُحفظ في notifications؟ | target_portal | target_role | يلتقطه Driver Portal؟ |
|-----------------|--------------|--------|-------------------------|---------------|-------------|------------------------|
| driver.order.ready | `driver.order.ready` | ✅ عند READY للمتجر | ✅ | `driver` | `driver` | ✅ (جرس + صفحة إشعارات) |
| driver.order.assigned | `driver.task.assigned` | ⚠️ جزئي | ✅ عند الإنشاء | `driver` | `driver` | ✅ |
| driver.order.cancelled | `driver.task.cancelled` | ⚠️ جزئي | ✅ عند الإنشاء | `driver` | `driver` | ✅ |

### تفاصيل كل حدث

#### `driver.order.ready`

| البند | القيمة |
|-------|--------|
| **أين يُنشأ** | `shared/services/unifiedOrderStatus.js` (عند `DELIVERY_STATUS.READY`) |
| **الدالة** | `notificationEvents.notifyDriversOrderReady(sb, order, nearestDrivers)` |
| **المستلمون** | أقرب المناديب من `getNearestDrivers()` فقط — ليس كل المناديب |
| **شرط إضافي** | `resolveDriverUserId()` — يجب تطابق `drivers.phone` مع `users.phone` |
| **قنوات أخرى** | واتساب عبر `apps/driver/notify.js` → جدول `driver_notifications` (لا يظهر في البوابة) |
| **البوابة** | `portal-notifications-ops.js` → `GET /api/notifications?limit=40` (مفلتر server-side) |

#### `driver.task.assigned` (بديل assigned)

| البند | القيمة |
|-------|--------|
| **يُنشأ عند** | `POST /api/delivery/orders/:id/accept` · تعيين إداري `assign-driver` |
| **لا يُنشأ عند** | **`POST /api/driver/accept/:id`** ← المسار الذي تستخدمه Driver Portal |
| **الملفات** | `apps/delivery/routes.js` · `apps/admin/routes.js` |

#### `driver.task.cancelled` (بديل cancelled)

| البند | القيمة |
|-------|--------|
| **يُنشأ عند** | إلغاء طلب `portal === "merchant"` **و** `driver_id` معيّن |
| **لا يُنشأ عند** | إلغاء طلبات `transport` / `internal_delivery` مع `driver_id` — يُشعَر `provider_id` فقط |
| **الملف** | `notificationEvents.notifyOrderCancelled()` |

### تخزين target_portal / target_role

- **لا أعمدة مستقلة** في جدول `notifications`
- القيم في **`payload` JSON**: `payload.target_portal`, `payload.target_role`, `payload.event`
- الفلترة: `apps/notifications/routes.js` → `filterNotificationsForPortal(items, portalCtx)`
- **لا فلترة portal على العميل** — الاعتماد على API

---

## 3. Order Visibility Audit

| المرحلة | النظام القديم (`/driver`) | Driver Portal (`/driver-preview`) | نفس البيانات؟ |
|---------|---------------------------|----------------------------------|---------------|
| **Ready Queue** | `j.ready_queue` + fallback من `j.orders` | `state.orders.ready_queue` فقط | ⚠️ نفس API — لكن البوابة **لا تعرض** `legacy_open` |
| **Active Orders** | `j.active` | `state.orders.active` | ✅ نفس الحقل |
| **Completed Orders** | `j.completed` | `state.orders.completed` | ✅ نفس الحقل |
| **طلبات open قديمة** (`new`/`pending` غير متجر) | يعرض من `j.orders` كـ `legacyPending` | **لا يعرض** — يتجاهل `legacy_open` | ❌ |
| **تحديث تلقائي** | polling كل 8 ثوانٍ + صوت | تحديث يدوي فقط | ❌ |
| **GPS / القرب** | `POST /api/driver/update-location` كل 15ث | **لا يرسل موقعاً** | ❌ حاسم |
| **تتبع حي** | `/driver-app` + socket.io | رابط خارجي للوحة الكلاسيكية | ❌ |

### فلتر الجغرافيا (نقطة انقطاع حرجة)

في `apps/driver/routes.js` → `GET /orders`:

```javascript
if (!Number.isFinite(meLat) || !Number.isFinite(meLng)) return false;
// ...
const nearest = activeList.sort(...).slice(0, 3);
return nearest.some((d) => d.id === meId);
```

**النتيجة:** مندوب بدون إحداثيات في جدول `drivers` **لا يرى أي طلب في Ready Queue** — حتى لو وصله إشعار واتساب.

النظام القديم يرسل GPS باستمرار → يدخل في قائمة «أقرب 3» → يرى الطلبات.  
Driver Portal لا يرسل GPS → قد تبقى `ready_queue` **فارغة دائماً**.

---

## 4. Source Of Truth

### ما هو المصدر الرسمي؟

| الطبقة | المصدر | الحالة |
|--------|--------|--------|
| **Server config** | `shared/utils/portalLaunch.js` | `driver: true` → `/driver-preview` |
| **Browser login** | `public/assets/role-routing.js` | `driver: false` → **`/driver`** |
| **اختبارات الوحدة (server)** | `resolvePortalRole.test.js` | تتوقع `/driver-preview` |
| **تشغيل فعلي للمندوب** | `/driver` + `/driver-app` | GPS · polling · خريطة · صوت |

**الحكم:** المصدر الرسمي **مُعلَن** كـ Driver Portal، لكن **التشغيل الفعلي** ما زال على Legacy Driver.

### ما الذي يعتمد على النظام القديم؟

| المكوّن | الاعتماد على Legacy |
|---------|---------------------|
| توجيه ما بعد تسجيل الدخول | ✅ `role-routing.js` |
| إرسال الموقع للفلتر الجغرافي | ✅ `driver.html` / `driver-app.html` |
| اكتشاف طلبات جديدة (صوت) | ✅ polling + `/sound.mp3` |
| التتبع الحي للعميل | ✅ `driver-app.html` + socket |
| قبول طلبات `legacy_open` | ✅ `driver.html` |
| روابط داخل البوابة | ✅ «اللوحة الكاملة» → `/driver` |
| E2E structural validation | ⚠️ يستخدم mock API — لا يختبر GPS/polling |

### ما الذي تعتمد عليه البوابة من Backend مشترك؟

| API | مشترك |
|-----|-------|
| `GET /api/driver/orders` | ✅ |
| `POST /api/driver/accept/:id` | ✅ |
| `POST /api/driver/start-delivery/:id` | ✅ |
| `POST /api/driver/complete-order/:id` | ✅ |
| `GET /api/notifications*` | ✅ (مع فلتر portal) |

---

## 5. التقرير النهائي — PASS / FAIL

| العنصر | النتيجة | السبب |
|--------|---------|--------|
| **Order Assignment** | **FAIL** | لا تعيين تلقائي عند READY؛ القبول عبر `/api/driver/accept` **لا يُصدر** `driver.task.assigned`؛ فلتر GPS قد يمنع رؤية الطلب قبل القبول |
| **Driver Notification** | **PASS** (جزئي) | `driver.order.ready` يُنشأ ويُحفظ بـ `target_portal: driver` — لكن **لأقرب 3 مناديب** فقط وبشرط تطابق الهاتف |
| **Ready Queue** | **FAIL** | نفس API لكن البوابة بدون GPS → قائمة فارغة؛ لا polling؛ لا `legacy_open` |
| **Active Orders** | **PASS** | نفس bucket `active` بعد القبول — يعمل إذا وصل المندوب لمرحلة القبول |
| **Portal Visibility** | **FAIL** | تعارض live/legacy في التوجيه؛ البوابة ناقصة تشغيلياً (GPS · polling · تتبع) |

### **الحكم الإجمالي: FAIL**

التقارير السابقة التي أظهرت PASS للبوابة كانت **اختبارات هيكلية/E2E ببيانات mock** — لا تغطي:
- فلتر أقرب 3 مناديب
- غياب GPS من Driver Portal
- تعارض `portalLaunch.js` vs `role-routing.js`
- مسار القبول بدون إشعار assignment

---

## 6. نقاط الانقطاع المرتبة بالأولوية

```
┌─────────────────────────────────────────────────────────────┐
│ 1. role-routing.js: driver: false  →  تسجيل الدخول /driver │
├─────────────────────────────────────────────────────────────┤
│ 2. Driver Portal لا يرسل GPS  →  ready_queue فارغة          │
├─────────────────────────────────────────────────────────────┤
│ 3. لا polling في البوابة  →  الطلبات لا تظهر إلا بتحديث يدوي │
├─────────────────────────────────────────────────────────────┤
│ 4. إشعار ready لأقرب 3 فقط + شرط phone match               │
├─────────────────────────────────────────────────────────────┤
│ 5. legacy_open غير معروض في driver-preview.js               │
├─────────────────────────────────────────────────────────────┤
│ 6. /api/driver/accept لا يُصدر driver.task.assigned          │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. مراجع الكود

| الموضوع | المسار |
|---------|--------|
| Driver Portal UI | `public/assets/driver-preview.js` |
| Legacy board | `public/driver.html` |
| Legacy tracking | `public/driver-app.html` |
| Driver orders API | `apps/driver/routes.js` |
| فلتر الجغرافيا | `apps/driver/routes.js` (~516–533) |
| إشعار READY | `shared/services/unifiedOrderStatus.js` (~267–279) |
| كتالوج الأحداث | `shared/services/notificationEvents.js` |
| فلتر إشعارات البوابة | `shared/utils/notificationPortalRouting.js` |
| فلتر طلبات البوابة | `shared/utils/orderPortalRouting.js` |
| إطلاق server | `shared/utils/portalLaunch.js` (`driver: true`) |
| إطلاق browser | `public/assets/role-routing.js` (`driver: false`) |
| جرس البوابة | `public/assets/portal-framework/portal-notifications-ops.js` |
| E2E mock | `tests/e2e/core-validation.spec.js` |

---

## 8. توصيات (للمرحلة التالية — دون تنفيذ الآن)

1. **موحّد التوجيه:** مزامنة `role-routing.js` مع `portalLaunch.js` أو جلب `PORTAL_LIVE` من API.
2. **GPS في البوابة:** استدعاء `POST /api/driver/update-location` من `driver-preview.js` (كما في legacy).
3. **Polling خفيف:** `setInterval` لـ `/api/driver/orders` كل 8–15 ثانية في البوابة.
4. **عرض `legacy_open`:** أو دمجها في Ready Queue في `driver-preview.js`.
5. **إشعار عند القبول:** إضافة `driver.task.assigned` (أو تأكيد) في `POST /api/driver/accept/:id`.
6. **اختبار تكاملي حقيقي:** E2E بمسار كامل (ready → notify → GPS → ready_queue → accept → active) بدون mock.

---

*تم إعداد هذا التقرير من تدقيق الكود المصدر — دون تنفيذ طلب حي على قاعدة الإنتاج.*
