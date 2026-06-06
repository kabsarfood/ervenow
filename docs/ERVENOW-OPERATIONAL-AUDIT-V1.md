# ERVENOW OPERATIONAL AUDIT V1

**التاريخ:** 2026-06-05  
**النوع:** تدقيق تشغيلي من الكود + smoke tests (بدون إنتاج حي)  
**المبدأ:** كل رحلة تبدأ من العميل وتنتهي عند العميل

---

## النتيجة النهائية

**عدد السيناريوهات الناجحة: 0 / 5**

| السيناريو | الحكم | السبب المختصر |
|-----------|-------|---------------|
| 1 — متجر | ☐ ناجح ☑ **فشل** | لا accept/prepare/ready للمتجر؛ `accepted` مشترك مع المندوب |
| 2 — مطعم | ☐ ناجح ☑ **فشل** | نفس pipeline المتجر |
| 3 — غاز | ☐ ناجح ☑ **فشل** | المندوب مستبعد؛ إتمام gas مكسور في `completeServiceOrder` |
| 4 — خدمة منزلية | ☐ ناجح ☑ **فشل** | `after_diagnosis` غير مُطبَّق في checkout؛ لا UI إتمام للعميل |
| 5 — نقل مركبة | ☐ ناجح ☑ **فشل** | cart checkout لا يمر عبر `createCarTransport`؛ المندوب مستبعد |

---

# السيناريو 1 — متجر

## العميل

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| تسجيل الدخول | ✅ | `login.html` → `/api/core/send-otp`, `verify-otp` |
| دخول متجر | ✅ | `stores.html` → `store.html` |
| إضافة منتج | ✅ | `ErvenowCart.add()` + `pre-cart-delivery.js` |
| السلة | ✅ | `/cart` → `cart.html` |
| الدفع | ✅ | `cart.js` → `POST /api/order/create` |
| إنشاء الطلب | ✅ | `apps/checkout/service.js` → `delivery_status: pending` |

## المتجر

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| وصول الطلب | ⚠️ جزئي | `merchant-dashboard.html` — **عرض فقط** + WhatsApp |
| قبول الطلب | ❌ | **لا UI** يستدعي `PATCH /api/order/:id/status` |
| تجهيز الطلب | ❌ | **لا حالة `prepare`** في FSM |
| جاهز للاستلام | ❌ | **لا حالة `ready`** في FSM |

## المندوب

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| استلام الطلب | ✅* | `POST /api/driver/accept/:id` |
| التوجه للمتجر | ⚠️ | `accepted`→`delivering` (يتخطى `picked`) |
| استلام من المتجر | ⚠️ | proximity auto في `driver.html` |
| التوجه للعميل | ✅ | `delivering` |
| تسليم | ✅ | `POST /api/driver/complete-order/:id` |

\* فقط عند `fulfillment: ervenow_delivery` — ليس `store_delivery` أو `pickup`

## العميل (نهاية)

| الخطوة | الحالة | الدليل |
|--------|--------|--------|
| استلام | ⚠️ | إشعار WA + in-app عند `delivered` |
| تقييم | ✅ | `track.html` → `POST /api/order/:id/rate` |

**النتيجة: ☐ ناجح ☑ فشل**

---

# السيناريو 2 — مطعم

نفس pipeline المتجر؛ الفرق: `order_type: restaurant`، بادئة `ED`.

| المرحلة | الحالة |
|---------|--------|
| عميل → checkout | ✅ |
| مطعم تشغيلي | ❌ (نفس فجوة المتجر) |
| مندوب → تسليم | ✅* |
| تقييم | ✅ |

**النتيجة: ☐ ناجح ☑ فشل**

---

# السيناريو 3 — غاز

```
العميل → السلة → checkout → الطلب → مزود الغاز → المندوب → العميل
```

| المرحلة | الحالة | الدليل |
|---------|--------|--------|
| عميل → cart | ✅ | `gas-delivery.html` → `ErvenowServiceCart` |
| checkout → create | ⚠️ | `createServiceOrder` (ليس `createGasDelivery`) — حالة أولية مختلفة |
| مزود الغاز | ✅ | `services-provider.html` → reserve |
| المندوب | ❌ | `DRIVER_EXCLUDED_ORDER_TYPES` يتضمن `gas_delivery` |
| إتمام مزود | ❌ | `isServiceOrderRow()` يقبل `service` فقط — **gas_delivery يرفض** |
| تتبع العميل | ⚠️ | لا `drop_lat/lng` من cart → لا `/track` |

**النتيجة: ☐ ناجح ☑ فشل**

---

# السيناريو 4 — خدمة منزلية (`after_diagnosis`)

| التحقق | الحالة | الدليل |
|--------|--------|--------|
| UI `payment_mode: after_diagnosis` | ✅ | `services.html` |
| حفظ في cart | ✅ | `data.payment_mode` في localStorage |
| تطبيق server-side في checkout | ❌ | `checkout/service.js` لا يقرأ `payment_mode` |
| `payment_status` عند الإنشاء | ⚠️ | `unpaid` افتراضي؛ gate قد يغيّره |
| مزود — reserve/complete | ✅ | `services-provider.html` |
| عميل — إتمام | ❌ | API موجود؛ **لا UI** في `my-orders` |
| مندوب | N/A | مستبعد by design |

**النتيجة: ☐ ناجح ☑ فشل**

---

# السيناريو 5 — نقل مركبة

| التحقق | الحالة | الدليل |
|--------|--------|--------|
| تقدير المسافة (UI) | ✅ | haversine في `delivery-services.html` |
| تسعير الخادم | ✅* | `createUnifiedDeliveryOrder` + OSRM |
| cart → create | ❌ | `runUnifiedDeliveryOnlyCreate` لا يستدعي `createCarTransport` |
| التتبع | ⚠️ | `/track` يحتاج coords — cart path ناقص |
| المندوب | ❌ | `car_transport` في `DRIVER_EXCLUDED_SERVICE_TYPES` |
| مزود pickup_truck | ✅ | `services-provider.html` |

\* مسار API المباشر `POST /api/delivery/create` فقط — ليس cart

**النتيجة: ☐ ناجح ☑ فشل**

---

# فحص الإشعارات (لكل سيناريو)

| القناة | متجر/مطعم | غاز/خدمة | ملاحظة |
|--------|-----------|----------|--------|
| العميل in-app | ⚠️ | ⚠️ | checkout cart: **لا** إشعار؛ `delivered`: ✅ |
| العميل WhatsApp | ⚠️ | ✅ غاز | driver accept: WA فقط |
| المتجر/مطعم | ✅ WA + in-app | — | `storeOrderPostCheckout.js` |
| مزود خدمة | — | ✅ dashboard-first | |
| المندوب | ✅ dispatch WA | ❌ مستبعد | |
| الإدارة | ⚠️ socket فقط | ⚠️ | `admin/modules/sockets.js` — لا in-app على طلب جديد |

| | العميل | المتجر | المطعم | المندوب | الإدارة |
|---|:---:|:---:|:---:|:---:|:---:|
| **الإجمالي** | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ |

---

# فحص الخرائط

| البند | الحالة | الدليل |
|-------|--------|--------|
| تحديد الموقع | ✅ | `pre-cart-delivery.js`, `delivery-map-page.js` |
| تعديل الموقع | ✅ | cart delivery editor |
| حفظ الموقع | ✅ | `cart` v2 + `ervenow:delivery-location` |
| رسوم التوصيل | ✅ | `deliveryPolicyEngine`, store quote API |
| ETA | ⚠️ | `track.html` — يعتمد coords + OSRM |
| التتبع المباشر | ⚠️ | Socket.IO `trackingSocket.js` — يحتاج coords + مندوب |

---

# فحص المحافظ

| البند | الحالة | الدليل |
|-------|--------|--------|
| خصم (ew_pay checkout) | ✅ | `ervenowPayCheckout.js` + unit tests |
| شحن | ✅ | `/api/wallet/topup-request`, admin deposit |
| استرداد | ✅ | `/api/wallet/ledger/refund` (admin) |
| تسوية عند delivered | ✅ | `deliveredFinancialSettlement.js` |

**ملاحظة:** لم يُختبر end-to-end في هذا التدقيق — unit tests فقط.

---

# فحص التقارير

| البند | الحالة | الدليل |
|-------|--------|--------|
| ظهور الطلب | ✅ | admin orders, merchant-dashboard |
| ظهور العمولة | ✅ | `admin/modules/finance.js`, ledger tests |
| ظهور الإيراد | ✅ | `/api/admin/finance-summary` |

**ملاحظة:** يعتمد على بيانات إنتاج / settlement فعلي.

---

# أخطاء حرجة يجب إصلاحها (بدون ميزات جديدة)

1. **`completeServiceOrder.js` L18–22** — `isServiceOrderRow` يجب أن يقبل `gas_delivery`
2. **لوحة المتجر** — ربط `PATCH /api/order/:id/status` (accept على الأقل)
3. **checkout cart** — تطبيق `payment_mode: after_diagnosis` من `data`
4. **checkout cart car transport** — توجيه إلى `createUnifiedDeliveryOrder`
5. **توثيق fulfillment** — غاز/خدمة/نقل = مزود خدمة وليس مندوب المنصة

---

# مسار الانتقال إلى 5/5

| # | الإجراء | يُغلق |
|---|---------|--------|
| 1 | إصلاح `isServiceOrderRow` + gas complete | سيناريو 3 |
| 2 | UI accept للمتجر/المطعم (حتى `accepted` فقط) | 1 + 2 |
| 3 | `after_diagnosis` في checkout + UI complete عميل | 4 |
| 4 | cart car → `createCarTransport` | 5 |
| 5 | E2E Playwright كامل ضد Supabase staging | كل السيناريوهات |
| 6 | اختبار يدوي إنتاجي + إشعارات | الإشعارات + التقارير |

---

**الخلاصة:** المنصة **لا تنتقل بعد** إلى مرحلة الاعتمادية العالية (5/5).  
**الجاهزية التشغيلية للسوق:** ~**40%** على الرحلات الكاملة — **85%** على مسار العميل → إنشاء الطلب فقط.
