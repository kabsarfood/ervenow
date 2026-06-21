# ERVENOW — Service Portal Services Audit

**التاريخ:** 20 يونيو 2026  
**النطاق:** 8 أنواع خدمة في Service Portal (عميل + مزوّد)  
**المصدر:** تدقيق الكود — `services.html` · `car-polishing.html` · `gas-delivery.html` · `service-preview.js` · `apps/services/routes.js` · `homeServicePricing.js` · `serviceProviderTypes.js`

---

## ملخص تنفيذي

| السؤال | الجواب |
|--------|--------|
| هل Service Portal جاهز للإطلاق؟ | **لا — غير Stable** |
| خدمات PASS كاملة | **2/8** (تلميع مركبات · تعبئة غاز مركزي) |
| فصل المزوّدين | **PASS** — كل نوع يرى طلباته فقط |
| أكبر فجوة | **خيارات طلب العميل** (معظم الخدمات بدون subtypes) + **Workflow** (المنزلية + أسطوانات الغاز) |

---

# 1. سباك — `plumber`

## Customer Request Options

**ما يراه العميل فعلياً:** بطاقة واحدة «سباك» — **بدون** قائمة مهام (لا تركيب خلاط · لا تسليك · لا إصلاح تسريب).

| خيار مطلوب (مثال) | موجود؟ |
|-------------------|--------|
| تركيب خلاط | ❌ |
| تسليك | ❌ |
| إصلاح تسريب | ❌ |
| أخرى | ❌ |

**المسار:** `/services?type=plumber` → نموذج موحّد (`services.html` · `ORDER_CARD_KEYS`).

## Service Form Audit

| الحقل | موجود؟ |
|-------|--------|
| الحي | ✅ `svcDistrict` |
| الجوال | ✅ `svcPhone` |
| الموقع + GPS | ✅ `svcLocation` · `svcGeoBtn` |
| طريقة الدفع | ✅ cart / on_service / after_diagnosis |
| صور | ❌ |
| موعد مجدول | ❌ |
| ملاحظات | ❌ |
| نوع المهمة | ❌ |

## Pricing Audit

| النموذج | التفاصيل |
|---------|----------|
| **معاينة ثابتة** | 60 ر.س — `inspectionOnly: true` · `homeServicePricing.js` |
| تسعير يدوي لاحقاً | ✅ الإصلاح يُحسب بعد المعاينة |
| تسعير ثابت للإصلاح | ❌ |

## Workflow Audit

```
طلب جديد (pending) → حجز (accepted) → «في الطريق» (delivering)* → إغلاق (delivered)
```

| المرحلة | الحالة |
|---------|--------|
| قبول | ✅ `POST /bookings/:id/reserve` |
| في الطريق | ⚠️ PATCH `delivering` يُفعّل `provider_completed_at` مبكراً |
| تنفيذ | ⚠️ «تم التنفيذ» متاح من `accepted` فقط — بعد «في الطريق» يختفي |
| إغلاق | ✅ `completeServiceOrder` + ledger |

## Provider Separation — **PASS**

`bookingTypesForProvider("plumber") → ["plumber"]` + فلترة الحي.

---

# 2. كهربائي — `electrician`

## Customer Request Options

**بطاقة واحدة «كهربائي»** — بدون subtypes (لا تركيب إنارة · لا إصلاح أعطال · لا أخرى).

## Service Form Audit

نفس نموذج `services.html` (حي · جوال · موقع · دفع) — **بدون** صور · موعد · ملاحظات · نوع مهمة.

## Pricing Audit

**60 ر.س معاينة** — `inspectionOnly` · دفع بعد التقييم (`after_diagnosis`).

## Workflow Audit

**نفس فجوة السباك** — en route مدمج مع إتمام المزوّد.

## Provider Separation — **PASS**

---

# 3. فني تكييف — `ac_technician`

## Customer Request Options

**بطاقة واحدة «فني مكيفات»** — بدون:

| خيار مطلوب | موجود؟ |
|------------|--------|
| تنظيف | ❌ |
| صيانة | ❌ |
| تعبئة فريون | ❌ |
| فك وتركيب | ❌ |

## Service Form / Pricing / Workflow

مطابق للسباك/الكهربائي: نموذج أساسي · 60 ر.س معاينة · workflow جزئي.

## Provider Separation — **PASS**

---

# 4. غسيل فلل وعمائر — `laundry_estates`

> **ملاحظة:** العميل لا يطلب `laundry_estates` مباشرة — يطلب `cleaning_villa` أو `cleaning_building`.

## Customer Request Options

| خيار العميل | `service_type` | السعر |
|-------------|----------------|-------|
| غسيل درج فيلا | `cleaning_villa` | 60 ر.س ثابت |
| غسيل درج عمارة (3 أدوار) | `cleaning_building` | 120 ر.س ثابت |

**لا يوجد** نموذج «مغسل فلل» عام للعميل — فقط النوعان أعلاه.

## Service Form Audit

نموذج `services.html` — حي · جوال · موقع · دفع. **بدون** صور · موعد · ملاحظات.

## Pricing Audit

| النوع | النموذج |
|-------|---------|
| `cleaning_villa` | **ثابت** 60 ر.س |
| `cleaning_building` | **ثابت** 120 ر.س |
| `laundry_estates` (كتalog) | **اتفاق** — للمزوّد فقط |

## Workflow Audit

نفس فجوة الخدمات المنزلية (en route / execute).

## Provider Separation — **PASS**

المزوّد `laundry_estates` يرى: `cleaning_villa` · `cleaning_building` · `cleaning` · `laundry_estates` — **لا يرى** سباك/كهرباء/غاز.

---

# 5. تشجير — `agricultural_engineer`

## Customer Request Options

**بطاقة «مهندس زراعي»** (+ بطاقة «مشتل» `nursery` → تُوجَّه للمهندس الزراعي).

**بدون** subtypes تشجير/ري/صيانة حدائق.

## Service Form Audit

نموذج موحّد — **بدون** صور · موعد · ملاحظات.

## Pricing Audit

**60 ر.س معاينة** — التنفيذ والتسعير **حسب الاتفاق** بعد المعاينة.

## Workflow Audit

جزئي — نفس فجوة المنزلية.

## Provider Separation — **PASS**

`nursery` → `agricultural_engineer` في `normalizeProviderServiceType`.

---

# 6. تلميع مركبات — `car_polishing`

## Customer Request Options

**صفحة مخصصة:** `/car-polishing.html`

| الفئة | الخيارات |
|-------|----------|
| نوع المركبة | سيدان 280 · جيب 350 · فان 380 · حافلة 420 ر.س |
| إضافات | غسيل محرك +85 · عجلات +60 · خارجي +45 |
| الموعد | فوري أو مجدول (تاريخ + وقت) |

## Service Form Audit

| الحقل | موجود؟ |
|-------|--------|
| نوع المركبة | ✅ |
| إضافات | ✅ |
| موعد | ✅ immediate / scheduled |
| صور المركبة | ✅ حتى 10 (أمام/خلف/جانب) |
| ملاحظات | ✅ `cpNotes` (300 حرف) |
| الحي + الموقع + GPS | ✅ |
| الجوال | ✅ |

## Pricing Audit

**ثابت متدرّج + إضافات + VAT 15% + عمولة 7%** — `carPolishingPricing.js` · تحقق server-side.

## Workflow Audit

```
جديد → قبول/رفض → في الطريق (cp: on_the_way) → تنفيذ (in_progress) → إغلاق (delivered)
```

**مكتمل** — `carPolishingWorkflow.js` · أزرار منفصلة في `service-preview.js`.

## Provider Separation — **PASS**

---

# 7. تبديل غاز أسطوانات — `gas_cylinder_swap`

> **ملاحظة:** طلب العميل `service_type: gas_delivery` + `gas_mode: cylinder_swap`.

## Customer Request Options

**صفحة:** `/gas-delivery.html`

| الخيار | التفاصيل |
|--------|----------|
| نوع الخدمة | تبديل اسطوانة |
| الكمية | 1–10 أسطوانات |
| السعر | 38 ر.س / أسطوانة |

## Service Form Audit

| الحقل | موجود؟ |
|-------|--------|
| الكمية | ✅ |
| الحي | ✅ |
| الموقع + GPS | ✅ |
| الجوال | ✅ |
| صور | ❌ |
| موعد | ❌ |
| ملاحظات | ❌ |

## Pricing Audit

**ثابت:** `qty × 38` — `gasDeliveryPricing.js`.

## Workflow Audit

| المرحلة | الحالة |
|---------|--------|
| قبول | ✅ |
| في الطريق | ⚠️ زر موجود — backend يخلط مع إتمام المزوّد |
| تنفيذ | ❌ لا مرحلة منفصلة |
| إغلاق | ✅ |

**فلترة GPS + نطاق** للمزوّد.

## Provider Separation — **PASS**

`gas_cylinder_swap` يرى `gas_delivery` حيث `gas_mode ≠ central_refill` فقط.

---

# 8. تعبئة غاز مركزي — `gas_central_refill`

> **ملاحظة:** طلب العميل `gas_delivery` + `gas_mode: central_refill`.

## Customer Request Options

| الخيار | التفاصيل |
|--------|----------|
| نوع الخدمة | تعبئة غاز مركزي |
| اللترات | 250 · 500 · 1000 · 2000 · 3000 · 4000 |
| السعر | 1 ر.س / لتر |

## Service Form Audit

| الحقل | موجود؟ |
|-------|--------|
| اللترات | ✅ |
| اسم المنشأة/الحي | ✅ |
| الموقع + GPS | ✅ |
| الجوال | ✅ |
| صور · موعد · ملاحظات | ❌ |

## Pricing Audit

**ثابت:** `liters × 1` ر.س.

## Workflow Audit

```
قبول → بدء التعبئة (provider step) → إنهاء + actual_liters → delivered
```

**بدون** «في الطريق» (مقصود) — **تنفيذ + إغلاق واضحان** في Portal.

## Provider Separation — **PASS**

يرى `central_refill` فقط — **لا يرى** أسطوانات.

---

# Provider Separation Audit — إثبات الفصل

| الطبقة | الملف | الآلية |
|--------|-------|--------|
| DB filter | `apps/services/routes.js` | `applyServiceTypeFilter` + `bookingTypesForProvider` |
| Row filter | `filterBookingsForProvider` | نوع + gas_mode + حي/نطاق |
| Reserve guard | `POST /bookings/:id/reserve` | `providerMatchesBookingType` |
| Notify | `homeServiceNotify.js` · `gasDeliveryNotify.js` | نفس المطابقة |

**إثبات:**

| مزوّد | يرى | لا يرى |
|-------|-----|--------|
| `plumber` | `plumber` | electrician, ac, gas, car_polish, … |
| `electrician` | `electrician` | plumber, ac, … |
| `ac_technician` | `ac_technician` | plumber, electrician, … |
| `laundry_estates` | cleaning_* · laundry_estates | plumber, gas, … |
| `agricultural_engineer` | agricultural_engineer | plumber, gas, … |
| `car_polishing` | car_polishing | كل الأنواع الأخرى |
| `gas_cylinder_swap` | gas_delivery + cylinder | central_refill · plumber · … |
| `gas_central_refill` | gas_delivery + central | cylinder_swap · plumber · … |

**الحكم: PASS** — لا تسريب cross-type في الكود.

---

# Service Portal Readiness Matrix

| الخدمة | Customer UI | Pricing | Workflow | Wallet | Notifications | **PASS/FAIL** |
|--------|-------------|---------|----------|--------|---------------|---------------|
| Plumber | **FAIL** — بدون subtypes مهمة | **PASS** — معاينة 60 | **FAIL** — en route/execute | **PASS** | **PASS** | **FAIL** |
| Electrician | **FAIL** — بدون subtypes | **PASS** — معاينة 60 | **FAIL** | **PASS** | **PASS** | **FAIL** |
| AC | **FAIL** — بدون subtypes (تنظيف/صيانة/فريون) | **PASS** — معاينة 60 | **FAIL** | **PASS** | **PASS** | **FAIL** |
| Laundry Estates | **PASS** — villa/building | **PASS** — ثابت 60/120 | **FAIL** | **PASS** | **PASS** | **FAIL** |
| Agricultural Engineer | **FAIL** — بدون subtypes تشجير | **PASS** — معاينة + اتفاق | **FAIL** | **PASS** | **PASS** | **FAIL** |
| Car Polishing | **PASS** — مركبة+إضافات+صور+موعد | **PASS** — متدرّج+VAT | **PASS** | **PASS** | **PASS** | **PASS** |
| Gas Cylinder Swap | **PASS** — qty 1–10 | **PASS** — 38/أسطوانة | **FAIL** | **PASS** | **PASS** | **FAIL** |
| Gas Central Refill | **PASS** — liters tiers | **PASS** — 1/لتر | **PASS** | **PASS** | **PASS** | **PASS** |

**PASS: 2/8 · FAIL: 6/8**

---

# Wallet & Notifications (مشترك)

| القدرة | Service Portal | الدليل |
|--------|----------------|--------|
| رصيد + معاملات | ✅ | `service-preview.js` · `/api/services/me/dashboard` |
| سحب OTP | ✅ | `portal-wallet-withdraw.js` |
| إشعار طلب جديد | ✅ | `service.request.new` |
| تسوية مالية | ✅ | `service.payment.settled` |
| إعدادات دفع | ✅ | `portal-provider-payment.js` |
| GPS أثناء المهمة | ✅ | `portal-provider-job-gps.js` |

---

# فجوات مطلوبة قبل «Service Portal Stable»

## أولوية 1 — Customer Request Options

إضافة subtypes لكل خدمة منزلية (سباك · كهرباء · تكييف · تشجير) — حالياً **معاينة عامة فقط**.

## أولوية 2 — Workflow

فصل **«في الطريق»** عن **«تنفيذ»** للخدمات المنزلية وأسطوانات الغاز — mirror `carPolishingWorkflow` (`cp_status` أو `service_phase`).

الملفات المتأثرة:

- `shared/services/unifiedOrderStatus.js`
- `shared/services/completeServiceOrder.js`
- `public/assets/service-preview.js`

## أولوية 3 — Form enrichment

| الحقل | plumber–ac–laundry–ag | gas | car polish |
|-------|----------------------|-----|------------|
| صور | ❌ مطلوب | ❌ | ✅ |
| موعد | ❌ مطلوب | ❌ | ✅ |
| ملاحظات | ❌ مطلوب | ❌ | ✅ |

## أولوية 4 — توحيد UX

- `car_polishing` → `/car-polishing.html` (كامل)
- `gas_*` → `/gas-delivery.html` (جيد)
- plumber–ac → `/services` (نموذج minimal)

---

# التقرير النهائي

## هل Service Portal جاهز فعلاً للإطلاق؟

### **لا — Service Portal Stable غير مُحقَّق**

| ما يعمل | ما ينقص |
|---------|---------|
| فصل المزوّدين 100% | subtypes طلب العميل (6/8) |
| تلميع + غاز مركزي workflow كامل | workflow المنزلية + أسطوانات |
| تسعير واضح لكل نوع | صور/موعد/ملاحظات للمنزلية |
| Wallet + Notifications + Payment settings | |

### قرار مقترح

**REUSE FIRST** — لا إعادة بناء:

1. Extend `services.html` form بـ `service_subtype` + notes + optional photos.
2. Add `service_phase` column أو reuse `cp_status` pattern for home/gas cylinder.
3. Keep `car_polishing` + `gas_central_refill` as reference implementations.

**بعد إغلاق الفجوات → إعادة Matrix → هدف 8/8 PASS → إعلان Service Portal Stable.**

---

## مراجع الكود

| الموضوع | المسار |
|---------|--------|
| كتalog + تسعير | `shared/utils/homeServicePricing.js` |
| مطابقة مزوّد | `shared/utils/serviceProviderTypes.js` |
| فلترة طلبات | `apps/services/routes.js` |
| Portal مزوّد | `public/assets/service-preview.js` |
| تلميع workflow | `shared/utils/carPolishingWorkflow.js` |
| غاز تسعير | `shared/utils/gasDeliveryPricing.js` |
| طلب عميل منزلية | `ervenow-frontend/services.html` |
| طلب تلميع | `ervenow-frontend/car-polishing.html` |
| طلب غاز | `ervenow-frontend/gas-delivery.html` |
