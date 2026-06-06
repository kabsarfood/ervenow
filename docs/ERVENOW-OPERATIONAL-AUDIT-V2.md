# ERVENOW OPERATIONAL AUDIT V2

**التاريخ:** 2026-06-05  
**النوع:** تدقيق تشغيلي من الكود + smoke tests (بدون إنتاج حي)  
**السياق:** بعد Order Board V1، Store Workflow، Gas Completion، Real-Time Store Notifications، Thermal Printing  
**المبدأ:** كل رحلة تبدأ من العميل وتنتهي عند العميل

---

## تحديث Phase 2 (2026-06-05)

**Audit V2 بعد إكمال مسار المندوب: 2 / 5 (كود)**

| السيناريo | بعد Phase 2 |
|-----------|-------------|
| متجر | ✅ |
| مطعم | ✅ |
| غاز / خدمات / نقل | ❌ (كما أدناه) |

راجع [`OPERATIONAL-FIXES-PHASE2-REPORT.md`](OPERATIONAL-FIXES-PHASE2-REPORT.md).

---

## النتيجة النهائية

**عدد السيناريوهات الناجحة: 0 / 5**

| السيناريو | الحكم | السبب المختصر |
|-----------|-------|---------------|
| 1 — متجر | ☑ **فشل** | لوحة المتجر كاملة؛ **انقطاع عند المندوب** بعد `ready` |
| 2 — مطعم | ☑ **فشل** | نفس pipeline المتجر (`order_type: restaurant`) |
| 3 — غاز | ☑ **فشل** | إنشاء + لوحة مزود؛ **لا إغلاق** بدون تأكيد عميل (لا UI) |
| 4 — خدمة منزلية | ☑ **فشل** | `after_diagnosis` غير مُطبَّق؛ لا دورة تشخيص/تسعير |
| 5 — نقل مركبات | ☑ **فشل** | إنشاء + تسعير + حجز مزود؛ **لا إغلاق** بدون تأكيد عميل |

**الحالة:** ERVENOW **غير** Operationally Validated — لا يُسمح ببدء Kitchen View / Smart Auto Pilot / Kiosk / QR Table حتى إصلاح الفجوات الحرجة.

---

# السيناريو 1 — متجر

## مسار العميل

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| إضافة للسلة | ✅ | `ErvenowCart` → `pre-cart-delivery.js` |
| الدفع | ✅ | `/cart` → `POST /api/order/create` |
| إنشاء الطلب | ✅ | `apps/checkout/service.js` → `delivery_status: pending`, `order_type: store` |

## التحقق — لوحة المتجر

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| ظهور الطلب في Order Board | ✅ | `GET /api/store/order-board` + `/order-board` |
| زيادة عداد Pending | ✅ | `countOrdersByStatus` + Socket `store:{id}` |
| قبول الطلب | ✅ | `order-board.js` → `PATCH …/status` → `accepted` |
| Preparing | ✅ | زر «بدء التجهيز» |
| Ready | ✅ | زر «جاهز للاستلام» + `notifyNearestDrivers` |
| إشعار المندوب | ✅ | `unifiedOrderStatus.js` عند `ready` |
| Picked Up | ❌ | **فجوة حرجة** — انظر أدناه |
| Delivered | ❌ | يعتمد على المندوب؛ المسار مقطوع |
| تقييم العميل | ⚠️ | `POST /api/order/:id/rate` + `track.html` — **بعد** `delivered` فقط |

## فجوة حرجة — المندوب بعد `ready`

1. **قائمة الطلبات المفتوحة** للمندوب: `delivery_status IN ('new','pending')` فقط — **لا يظهر `ready`**.  
   `apps/driver/routes.js` ~466–471

2. **قبول الطلب** (`POST /api/driver/accept/:id`): يعمل على `new|pending` فقط — **لا يقبل من `ready`**.  
   ~556–565

3. **واجهة المندوب** (`driver.html`): تتعامل مع `accepted` و `delivering` فقط — **لا `ready` / `picked_up` / `preparing`**.  
   ~671–696

4. **تعارض دلالي:** `accepted` = قبول المتجر في FSM المتجر، بينما المندوب كان يضبط `accepted` عند قبول طلب `pending` — مساران متعارضان.

## النتيجة

☑ **فشل** — الرحلة تتوقف بعد «جاهز للاستلام».

---

# السيناريو 2 — مطعم

نفس pipeline المتجر مع `order_type: restaurant` في `checkout/service.js`.

| التحقق | الحالة |
|--------|--------|
| Order Board + FSM + طباعة | ✅ |
| المندوب بعد `ready` | ❌ (نفس الفجوة) |
| تقييم العميل | ⚠️ (بعد delivered) |

## النتيجة

☑ **فشل**

---

# السيناريو 3 — غاز

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| إنشاء الطلب | ✅ | `gas-delivery.html` / cart → `createServiceOrder` → `order_type: gas_delivery` |
| وصوله للمزود | ✅ | `services-provider.html` + `bookingTypesForProvider(gas_*)` → `gas_delivery` |
| إتمام الخدمة | ⚠️ | `POST /api/services/bookings/:id/complete` — مزود فقط → `delivering` |
| إغلاق الطلب | ❌ | يتطلب `actor: customer` → `delivered`؛ **لا UI للعميل** في `my-orders` |

`completeServiceOrder.js`: مزود يُنهي → `delivering`؛ إغلاق نهائي يحتاج تأكيد عميل.

## النتيجة

☑ **فشل** — يتوقف عند «بانتظار تأكيد العميل».

---

# السيناريو 4 — خدمات منزلية

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| الحجز | ✅ | `services.html` → cart → `createServiceOrder` |
| التشخيص | ❌ | لا API/FSM للتشخيص |
| التسعير | ❌ | لا تحديث سعر بعد الحجز |
| الموافقة | ❌ | `payment_mode: after_diagnosis` في UI فقط — **غير مُمرَّر في checkout** |
| الإتمام | ⚠️ | مزود: `complete` → `delivering`؛ عميل: **لا UI** |

## النتيجة

☑ **فشل**

---

# السيناريو 5 — نقل مركبات

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| إنشاء الطلب | ✅ | `delivery-services.html` → cart → `runUnifiedDeliveryOnlyCreate` → `createCarTransport` |
| التسعير | ✅ | `computeUnifiedDeliveryFee('car_transport', …)` |
| التعيين | ✅ | `POST /api/services/bookings/:id/reserve` — مزود `pickup_truck` |
| التنفيذ | ⚠️ | `complete` من لوحة المزود → `delivering` |
| الإغلاق | ❌ | نفس فجوة تأكيد العميل؛ المندوب **مستبعد** (`driverDispatchOrders`) |

## النتيجة

☑ **فشل**

---

# التقييم النهائي

| النتيجة | الحالة |
|---------|--------|
| 0 / 5 | ☑ **الحالي** |
| 1 / 5 | ☐ |
| 2 / 5 | ☐ |
| 3 / 5 | ☐ |
| 4 / 5 | ☐ |
| 5 / 5 | ☐ |

---

# القرار

**ERVENOW ليست Operationally Validated.**

لا يُسمح بالبدء في:

1. Kitchen View  
2. Smart Auto Pilot  
3. Self Ordering Kiosk  
4. QR Table Ordering  

حتى إغلاق الفجوات الحرجة أدناه.

---

# الفجوات الحرجة — أولوية الإصلاح

## P0 — متجر / مطعم (يُفتح 2/5)

| # | الإصلاح | الملفات المتوقعة |
|---|---------|------------------|
| 1 | إظهار طلبات `ready` للمندوب (بدون `driver_id`) | `apps/driver/routes.js` |
| 2 | قبول من `ready` → `picked_up` + `driver_id` | `apps/driver/routes.js`, FSM |
| 3 | UI المندوب: `ready` → استلام → `delivering` → `delivered` | `public/driver.html` |
| 4 | فصل دلالة «قبول المتجر» عن «قبول المندوب» في FSM أو الحالات | `shared/utils/helpers.js`, docs |

## P0 — خدمات / غاز / نقل (يُفتح 3/5 إضافية)

| # | الإصلاح |
|---|---------|
| 5 | UI عميل: «تأكيد إتمام الخدمة» → `POST …/complete` بـ `step: customer` | `my-orders.html` أو `track.html` |
| 6 | أو: إتمام مزود واحد للغاز/نقل البسيط (`actor: both` عند `gas_delivery` / `vehicle_transfer`) |

## P1 — خدمات منزلية

| # | الإصلاح |
|---|---------|
| 7 | تمرير `payment_mode: after_diagnosis` في checkout |
| 8 | FSM: تشخيص → عرض سعر → موافقة → دفع → تنفيذ |

---

# ما تحسّن عن Audit V1

| البند | V1 | V2 |
|-------|----|----|
| قبول/تجهيز/جاهز للمتجر | ❌ | ✅ Order Board |
| Real-time للمتجر | ❌ | ✅ Socket `store:{id}` |
| طباعة 80mm | ❌ | ✅ |
| إتمام gas في Backend | ❌ | ✅ `completeServiceOrder` |
| نقل مركبات من السلة | ❌ | ✅ `createCarTransport` عبر cart |
| المندوب بعد ready | ❌ | ❌ **لا يزال** |
| تأكيد عميل للخدمات | ❌ | ❌ **لا يزال** |
| after_diagnosis | ❌ | ❌ **لا يزال** |

---

# التحقق الآلي الحالي

```bash
npm test          # 40 suites / 151 tests — 100% نجاح
npm run test:e2e  # 6/6 smoke — صفحات + API health فقط (لا رحلات E2E)
```

**ملاحظة:** Smoke tests لا تغطي الرحلات الخمس — Operational Validation يحتاج **Audit V2 live** أو **Playwright journey tests** بعد إصلاح P0.

---

# الخطوة التالية الموصى بها

**Operational Fixes Phase 2 — Driver Handoff + Service Closure**

1. إصلاح P0 (متجر/مطعم) — أعلى أثر.  
2. إصلاح P0 (تأكيد عميل) — يفتح غاز + نقل.  
3. إعادة Audit V2 على staging حي → هدف **3/5** ثم **5/5**.
