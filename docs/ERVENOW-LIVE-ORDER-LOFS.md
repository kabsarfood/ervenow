# ERVENOW Live Order™ — Functional Specification (LOFS)

**النوع:** مواصفات وظيفية — مرجع تنفيذ نهائي  
**الإصدار:** 1.2  
**التاريخ:** 2026-07-03  
**الحالة:** معروض للاعتماد — **لا كود · لا Migration · لا API قبل اعتماد هذه الوثيقة**  
**المعمارية المرجعية:** [ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md](./ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md) (v2.2)  
**التسمية:** [ERVENOW-NAMING-STANDARD-v1.0.md](./ERVENOW-NAMING-STANDARD-v1.0.md)  
**النطاق:** جميع خدمات ERVENOW — مطاعم · متاجر · خدمات · نقل · غاز · Meshwar (مستقبلاً)

---

## 0. الغرض والمبدأ

تحوّل هذه الوثيقة التصميم المعماري v2 إلى **سيناريوهات تشغيلية واضحة** يجيب كل منها عن:

| السؤال | أين يُجاب |
|--------|-----------|
| **ماذا يحدث؟** | السيناريوهات §2 · الشاشات §4 |
| **متى يحدث؟** | Decision Matrix §3 · User Journey §1 |
| **لماذا يحدث؟** | Service Profile §3.0 · Decision Matrix §3 · رسائل الإغلاق §8 |

### 0.3 سلسلة القرار (v2.2) — إلزامية

```text
Service Type (order_type + service_type)
        ↓
Service Profiles           ← ما يُسمح تعديله · Quantity Model
        ↓
Capability Engine          ← حالة الطلب · Lock Point · overrides
        ↓
Live Order Engine          ← Preview · Apply
        ↓
Settlement Engine          ← الفروقات المالية
```

> **لا يكفي** حالة الطلب ولا Capability Engine وحدهما. كل تقييم يبدأ بـ `resolveServiceProfile(order)`.

### 0.4 رموز الجدول المرجعي (§3)

| الرمز | المعنى |
|-------|--------|
| ✅ | مسموح افتراضياً (Core Platform) |
| ❌ | ممنوع — الإغلاق أو السياسة |
| ⚠️ | مسموح بشروط — يُحدَّد في Capability Engine أو Smart Lock |
| 🔒 | مغلق نهائياً — Lock Point |
| — | غير منطبق على هذا النوع من الطلب |

### 0.5 أنواع الإجراءات (Actions)

| المفتاح | الوصف | العموديات |
|---------|--------|-----------|
| `add_item` | إضافة بند/منتج | مطاعم · متاجر |
| `remove_item` | حذف بند | مطاعم · متاجر |
| `change_qty` | تعديل الكمية | مطاعم · متاجر |
| `change_destination` | تغيير موقع التسليم/الوجهة | مطاعم · متاجر · توصيل · نقل |
| `change_notes` | تعديل ملاحظات الطلب | مطاعم · متاجر |
| `change_schedule` | تعديل الموعد | خدمات |
| `change_description` | تعديل وصف الطلب | خدمات · نقل |
| `change_images` | تعديل/إضافة صور | خدمات · نقل |
| `add_sub_service` | إضافة خدمة فرعية | خدمات |
| `change_pickup_time` | تعديل وقت الاستلام | متاجر (إن وُجد) |

> **قاعدة ذهبية:** لا يُطبَّق أي إجراء بدون **Live Preview** + موافقة العميل (§5).

---

## 1. User Journey — رحلة العميل

### 1.1 مخطط الرحلة الكاملة

```text
[إنشاء الطلب] ──► [تأكيد الدفع] ──► [صفحة الطلب / طلباتي]
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │  شريط Live Order: متاح · عداد UX · رسالة سبب   │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                              [زر: إدارة الطلب]  (إن window_open)
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │  نافذة Live Order: إجراءات من Service Profile §3.0 │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                              [اختيار إجراء] ──► [Live Preview §5]
                                              │
                              [تأكيد] ──► [Apply] ──► [نجاح / فشل §10]
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │  تحديث الطلب · إشعار · سجل تعديلات · محفظة       │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                    [متابعة الطلب] ──► /track · حالة · إغلاق نافذة
                                              │
                    [Lock Point] ──► رسالة سببية §8 · زر معطّل · تتبع فقط
                                              │
                    [delivered] ──► نهاية الرحلة · تقييم · سجل نهائي
```

### 1.2 المراحل التفصيلية

#### المرحلة A — إنشاء الطلب

| الخطوة | ماذا يرى العميل | النظام |
|--------|-----------------|--------|
| A1 | إتمام الدفع في checkout | `POST /api/order/create` أو checkout |
| A2 | شاشة نجاح + رقم الطلب | `delivery_status: pending` (أو `new`) |
| A3 | توجيه إلى `/my-orders` أو `/track` | إشعار تأكيد طلب (موجود) |

> **ملاحظة:** التعديل **قبل** الإرسال يبقى عبر `ErvenowOrderDraft` — خارج نطاق Live Order.

#### المرحلة B — ظهور «إدارة الطلب»

| الشرط | السلوك |
|-------|--------|
| `ERVENOW_LIVE_ORDER=1` + نوع الطلب مفعّل | يظهر الزر |
| `GET /api/orders/{id}/capabilities` → `window_open: true` | الزر **نشط** |
| `window_open: false` | الزر **معطّل** + `reasonMessageAr` |
| طلب POS خارجي (`external_order_id`) | الزر مخفي أو معطّل — `external:pos_locked` |
| طلب `pickup_only` | إجراءات محدودة (لا `change_destination`) |

**مواقع الزر:**

| الشاشة | المسار | الموضع |
|--------|--------|--------|
| تفاصيل الطلب | `/my-orders` → بطاقة الطلب | إجراء أساسي |
| التتبع | `/track?id=` | شريط علوي ثانوي |
| إشعار in-app | مركز الإشعارات | deep link → Live Order |

#### المرحلة C — فترة السماح (Live Window)

| العنصر | الوظيفة | مصدر القرار |
|--------|---------|-------------|
| شارة «التعديل متاح» | حالة بصرية | `window_open` |
| عداد تنازلي | **UX فقط** — تقدير | `estimatedCloseAt` |
| رسالة توضيحية | «يمكنك التعديل حتى …» | `predictLiveOrderClose()` |
| قائمة الإجراءات | أزرار مفعّلة/معطّلة | `available_actions[]` |

**سلوك العداد:**

- إذا انتهى العداد والحالة لم تصل Lock Point → **يبقى التعديل مفتوحاً** + تحديث التقدير.
- إذا وصلت Lock Point والعداد لم ينتهِ → **إغلاق فوري** + رسالة §8.

#### المرحلة D — إغلاق التعديل

| المحفز | ما يراه العميل |
|--------|----------------|
| `preparing` (سياسة) | `LO_MSG_MERCHANT_PREPARING` |
| `ready` | `LO_MSG_MERCHANT_READY` |
| `picked_up` | `LO_MSG_DRIVER_PICKUP` |
| `delivered` | زر مخفي — «تم التسليم» |
| `admin:force_lock` | `LO_MSG_ADMIN_FORCE_LOCK` |

#### المرحلة E — متابعة الطلب

- `/track` — خريطة · ETA · حالة fulfillment
- تبويب **سجل التعديلات** (§7) — مرئي دائماً بعد أول تعديل
- لا إعادة فتح نافذة التعديل بعد Lock

---

## 2. السيناريوهات التشغيلية

> كل سيناريو يتبع القالب: **الحالة → الإجراء → الشاشات → الرسائل → المالية → الإشعارات**.

### 2.1 قالب السيناريو

```text
السيناريو: {ID}
الحالة:    {delivery_status}
العمودية:  {restaurant | store | …}
الإجراء:   {action}
الممثل:    {customer | …}

── ماذا يحدث ──
1. …
2. …

── الشاشات ──
• العميل: …
• التاجر: …

── الرسائل ──
• …

── المالية ──
• …

── الإشعارات ──
• …
```

---

### 2.2 Pending / New

#### LO-SC-001 — إضافة منتج (مطعم/متجر)

| البند | التفاصيل |
|-------|----------|
| **الحالة** | `pending` أو `new` |
| **الإجراء** | `add_item` |
| **الممثل** | عميل |

**ماذا يحدث:**

1. Service Profile: `restaurant` يسمح `add_item`.
2. Capability Engine: الحالة `pending` — لم تُغلق النافذة.
3. Capability Engine: لا override مانع.
4. العميل يفتح «إدارة الطلب» → «إضافة إلى الطلب».
2. يختار من كتالوج الشريك (نفس المتجر/المطعم).
3. النظام يحسب السعر + ضريبة + أثر على التوصيل إن وُجد.
4. **Live Preview** — قبل 95 ر.س · بعد 118 ر.س · فرق +23 ر.س.
5. العميل يؤكد → `POST apply` → خصم/تحصيل الفرق حسب طريقة الدفع الأصلية.
6. `breakdown` يُحدَّث · `amendment_version++` · سجل amendment #1.

**الشاشات:**

| الطرف | ما يرى |
|-------|--------|
| **عميل** | Preview §5 → نجاح → بطاقة طلب محدّثة |
| **مطعم/متجر** | بطاقة طلب في merchant-dashboard: بند جديد + إجمالي جديد |
| **مندوب** | — (لا إشعار — لم يُعيَّن بعد) |
| **إدارة** | — (إلا إن delta > حد استثنائي) |

**الرسائل:**

- Preview: `LO_MSG_CHARGE_WALLET` أو `LO_MSG_CHARGE_COD`
- نجاح: `LO_MSG_ITEM_ADDED_SUCCESS`

**المالية:**

- delta > 0 → §6.1 (زيادة)
- تسوية تاجر/مندوب → تُؤجَّل لـ `delivered`

**الإشعارات:**

- `customer.live_order.applied`
- `customer.live_order.financial` (إن delta ≠ 0)
- `merchant.live_order.items`

---

#### LO-SC-002 — حذف منتج

| البند | التفاصيل |
|-------|----------|
| **الحالة** | `pending` / `new` |
| **الإجراء** | `remove_item` |

**ماذا يحدث:**

1. العميل يختار بنداً → «حذف من الطلب».
2. Live Preview: قبل 95 · بعد 78 · فرق −17 ر.س.
3. تأكيد → إيداع 17 ر.س في محفظة ERVENOW.
4. لا يُسمح بحذف آخر بند إن بقي بند واحد فقط (validation).

**المالية:** §6.2 (نقصان → محفظة)

**الإشعارات:** `merchant.live_order.items` · `customer.live_order.financial`

---

#### LO-SC-003 — تغيير موقع التسليم

| البند | التفاصيل |
|-------|----------|
| **الحالة** | `pending` / `new` / `accepted` |
| **الإجراء** | `change_destination` |
| **Phase** | 1 (أول إطلاق Live Order) |

**ماذا يحدث:**

1. خريطة تفاعلية أو لصق رابط Maps.
2. إعادة تسعير `delivery_fee` (OSRM).
3. Preview: عنوان قبل/بعد · رسوم توصيل قبل/بعد · delta إجمالي.
4. Apply → تحديث `drop_*` · بث Socket.

**الإشعارات:**

- `customer.live_order.applied`
- `driver.live_order.destination` — **فقط** إن `driver_id` معيّن

---

#### LO-SC-004 — تعديل الكمية (زيادة/نقصان)

مماثل LO-SC-001/002 حسب اتجاه delta.

---

#### LO-SC-005 — تعديل الملاحظات

| البند | التفاصيل |
|-------|----------|
| **الإجراء** | `change_notes` |
| **delta** | 0 عادة |
| **Preview** | قبل/بعد نص الملاحظة · «لا فرق مالي» |
| **إشعار تاجر** | `merchant.live_order.items` (ملخص: «تعديل ملاحظات») |

---

### 2.3 Accepted

#### LO-SC-010 — إضافة منتج بعد قبول المندوب

| البند | التفاصيل |
|-------|----------|
| **الحالة** | `accepted` |
| **الإجراء** | `add_item` |

**الفرق عن Pending:**

- المندوب **لم يستلم** بعد → التعديل مسموح (§3).
- التاجر قد يكون بدأ التحضير — إن `preparing` دخلت الحالة → ينتقل لـ LO-SC-020.
- إشعار التاجر **فوري** — قد يؤثر على وقت التحضير.

**الإشعارات:** كـ LO-SC-001 + لا إشعار مندوب (لم يغادر بعد أو حسب السياسة).

---

#### LO-SC-011 — تغيير موقع بعد قبول المندوب

- مسموح افتراضياً (§3).
- **إشعار مندوب:** `driver.live_order.destination` — إلزامي.
- خريطة المندوب تُحدَّث فوراً عبر `broadcastOrderPatch`.

---

### 2.4 Preparing

#### LO-SC-020 — إضافة مشروبات أثناء التحضير (سياسة افتراضية)

| البند | التفاصيل |
|-------|----------|
| **الحالة** | `preparing` |
| **الإجراء** | `add_item` (فئات: beverages, salads, desserts) |
| **حذف/كمية** | ❌ افتراضياً |

**ماذا يحدث:**

1. Service Profile `restaurant` + Capability Engine: `preparing` يسمح `add_item` لفئات محددة فقط.
2. `remove_item` = مرفوض — `LO_MSG_MERCHANT_PREPARING`.
3. Smart Lock (Phase 6): قفل per-line.

**الشاشات:**

- عميل: رسالة «يمكنك إضافة مشروبات فقط» إن Smart Lock مفعّل.
- مطعم: إشعار بند جديد — يُدمج في التحضير.

---

#### LO-SC-021 — محاولة حذف بند قيد التحضير

| النتيجة | السلوك |
|---------|--------|
| Preview | مرفوض — `403` + `LO_MSG_MERCHANT_PREPARING` |
| واجهة | زر الحذف معطّل + tooltip برسالة الإغلاق |

---

### 2.5 Ready

#### LO-SC-030 — محاولة تعديل أصناف

| النتيجة | السلوك |
|---------|--------|
| `add/remove/change_qty` | ❌ — `LO_MSG_MERCHANT_READY` |
| `change_destination` | ⚠️ حسب سياسة التاجر — افتراضياً ❌ عند `ready` |
| واجهة | «طلبك جاهز للتسليم» |

**الإشعارات:** `live_order.locked` → عميل + تاجر

---

### 2.6 Picked Up

#### LO-SC-040 — أي تعديل على الأصناف أو الموقع

| النتيجة | السلوك |
|---------|--------|
| جميع إجراءات البنود | ❌ |
| `change_destination` | ❌ — `LO_MSG_DESTINATION_AFTER_PICKUP` |
| واجهة | زر «إدارة الطلب» معطّل · CTA «تتبع التوصيل» |
| رسالة | `LO_MSG_DRIVER_PICKUP` |

**الإشعارات:** `live_order.locked` → عميل فقط

---

### 2.7 Delivering

- نفس قيود `picked_up` افتراضياً.
- رسالة: `LO_MSG_DRIVER_DELIVERING`
- متابعة `/track` فقط.

---

### 2.8 Delivered

| البند | السلوك |
|-------|--------|
| Live Order | 🔒 مغلق نهائياً |
| سجل التعديلات | قراءة فقط |
| تقييم | مسار موجود `/track` → rate |

---

### 2.9 عموديات أخرى — ملخص

#### خدمات منزلية (Service)

| الحالة (`sp_status`) | الإجراءات المتاحة |
|---------------------|-------------------|
| `pending` | `change_schedule` · `change_description` · `add_sub_service` |
| `accepted` | نفس ما سبق + قيود provider |
| `in_progress` | `change_description` ⚠️ · ~~`remove_service`~~ ❌ |
| `completed` | 🔒 |

**سيناريو LO-SC-050 — تعديل الموعد:**

- Preview: موعد قبل/بعد · delta قد = 0.
- إشعار: `service.schedule.updated` → مزود الخدمة.

#### نقل (Transport)

| الحالة | الإجراءات |
|--------|-----------|
| قبل `on_the_way` | `change_destination` |
| بعد `on_the_way` | ❌ موقع |

#### غاز (Gas / LPG)

| الحالة | الإجراءات |
|--------|-----------|
| قبل `accepted` (مزود) | `change_qty` ⚠️ · `change_destination` |
| بعد قبول المزود | 🔒 افتراضياً — `LO_MSG_PROVIDER_ACCEPTED` |

#### Meshwar (مستقبلاً)

- إنشاء `profile_key: meshwar` فقط — دون تعديل Live Order Engine (معمارية §3.9).
- `add_stop` — Phase لاحقة.

---

## 3. Decision Matrix — الجدول المرجعي الرسمي

> **هذا الجدول هو المرجع أثناء البرمجة.**  
> **الطبقة 1:** Service Profile (§3.0) — ما يُسمح أصلاً لهذا النوع.  
> **الطبقة 2:** Capability Engine (§3.2+) — ما يبقى مسموحاً حسب `delivery_status`.  
> **الطبقة 3:** `capability_rules` — override الشريك.

### 3.0 Service Profiles — الجدول المرجعي الأولي (Core)

| Profile | الخدمة | إضافة | حذف | كمية | موقع | موعد | وصف | صور | ملاحظات |
|---------|--------|:-----:|:---:|:----:|:----:|:----:|:---:|:---:|---------|
| `restaurant` | 🍴 مطاعم | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | أصناف ووجبات |
| `store` | 🛒 متاجر | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | منتجات |
| `pharmacy` | 💊 صيدليات | ⚠️ | ⚠️ | ⚠️ | ✅ | ❌ | ❌ | ❌ | قيود وصفة/منتج |
| `home_service` | 🔧 خدمات | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | لا commerce |
| `delivery` | 🚚 توصيل | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | استلام/تسليم |
| `car_transport` | 🚛 نقل | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | مركبة وبياناتها |
| `gas` | ⛽ غاز | ✅ | ⚠️ | ✅* | ✅ | ❌ | ❌ | ❌ | أسطوانات · لترات |
| `car_rental`* | 🚗 تأجير | ⚠️ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | قبل بدء العقد |

\* غاز — الكمية = أسطوانات **أو** لترات.  
\* `car_rental` — مستقبلاً.

**واجهة العميل:** `GET /api/orders/{id}/capabilities` يُرجع `available_actions` = تقاطع Profile + Capability Engine.

### 3.0.1 Quantity Model — معنى «الكمية» per Profile

| Profile | النموذج | الوحدة | أمثلة وظيفية |
|---------|---------|--------|--------------|
| `restaurant` | `line_items` | وجبة / صنف | 2 كبسة · 3 مشروبات |
| `store` | `line_items` | منتج | 5 قطع |
| `pharmacy` | `line_items` + قيود | منتج | ⚠️ أصناف بوصفة |
| `gas` (أسطوانة) | `cylinders` | أسطوانة | 2 أسطوانة |
| `gas` (تعبئة مركزية) | `liters` | لتر | 12 لتر |
| `home_service` | `none` | — | `change_qty` مرفوض دائماً |
| `car_transport` | `none` | — | — |
| `delivery` | `none` | — | — |

**سلوك واجهة `change_qty`:**

```text
إن profile.quantity_model.type === "none"
  → إخفاء stepper الكمية · LO_MSG_ACTION_NOT_ALLOWED عند المحاولة
```

### 3.1 مطاعم ومتاجر — تقييم الحالة (حالة × إجراء)

> يُطبَّق فقط عندما Profile = `restaurant` أو `store` أو `pharmacy`.

| حالة الطلب | إضافة | حذف | تعديل الكمية | تغيير الموقع | تعديل الملاحظات |
|------------|:-----:|:---:|:------------:|:------------:|:---------------:|
| `draft`* | — | — | — | — | — |
| `pending` / `new` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `accepted` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `preparing` | ⚠️ | ❌ | ❌ | ✅ | ⚠️ |
| `ready` | ❌ | ❌ | ❌ | ⚠️ | ❌ |
| `picked_up` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `picked` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `delivering` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `delivered` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| `cancelled_*` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |

\* `draft` = بوابة دفع — التعديل عبر Draft وليس Live Order.

**⚠️ Preparing — تفصيل Smart Lock (Phase 6):**

| الإجراء | القاعدة الافتراضية |
|---------|-------------------|
| `add_item` | مسموح لفئات: `beverages` · `salads` · `desserts` · `sides` |
| `change_notes` | مسموح إن لم يُطبَع التذكرة بعد |
| `change_destination` | مسموح حتى `ready` |

**⚠️ Ready — تغيير الموقع:**

- افتراضي Core: ❌
- override تاجر (Capability Engine): ✅ مع إشعار مندوب + إعادة تسعير

### 3.2 خدمات (Service)

| حالة الطلب | موعد | وصف | إضافة فرعية | حذف خدمة |
|------------|:----:|:---:|:-----------:|:--------:|
| `pending` | ✅ | ✅ | ✅ | ✅ |
| `accepted` | ✅ | ✅ | ✅ | ⚠️ |
| `in_progress`* | ⚠️ | ⚠️ | ⚠️ | ❌ |
| `completed` / `delivered` | 🔒 | 🔒 | 🔒 | 🔒 |

\* `in_progress` = `data.sp_status` — ليس بالضرورة `delivery_status`.

### 3.3 نقل (Transport)

| حالة الطلب | تغيير الوجهة | إضافة محطة |
|------------|:------------:|:----------:|
| `pending` / `new` | ✅ | — |
| `accepted` | ✅ | — |
| `on_the_way`* | ❌ | — |
| `delivered` | 🔒 | — |

\* أو ما يعادلها في `delivery_status` للنقل.

### 3.4 غاز (Gas)

| حالة الطلب | كمية | موقع | نوع أسطوانة |
|------------|:----:|:----:|:-----------:|
| قبل قبول المزود | ⚠️ | ✅ | ⚠️ |
| بعد قبول المزود | ❌ | ❌ | ❌ |
| `delivered` | 🔒 | 🔒 | 🔒 |

### 3.5 استلام من المتجر (Pickup)

| الإجراء | الحالة |
|---------|--------|
| `change_destination` | — (غير منطبق) |
| `change_pickup_time` | ⚠️ حتى `ready` |
| بنود | نفس جدول §3.1 |

### 3.7 مصفوفة القرار البرمجية

```javascript
// المرجع الوحيد في الكود — لا hardcode في الواجهات
const profile = resolveServiceProfile(order);
const decision = canPerform(order, action, actor);
// ترتيب داخلي: profile → businessRules → permissionOverride
// decision.allowed → يُفعّل الزر
// decision.source → "profile" | "capability" | "capability_override" | "denied"
// !decision.allowed → tooltip = decision.reasonMessageAr
```

---

## 4. الشاشات — تجربة كل طرف

### 4.1 العميل (Customer)

| الشاشة | المسار | المحتوى |
|--------|--------|---------|
| **قائمة الطلبات** | `/my-orders` | شارة «قابل للتعديل» إن `window_open` |
| **بطاقة الطلب** | `/my-orders` | حالة · إجمالي · زر «إدارة الطلب» |
| **نافذة Live Order** | modal / sheet | إجراءات من `profile.ui_config` · حالة · عداد UX |
| **إضافة بند** | داخل النافذة | كتالوج الشريك · بحث · سلة مؤقتة |
| **حذف/كمية** | داخل النافذة | قائمة بنود · stepper |
| **تغيير موقع** | داخل النافذة | خريطة · عنوان · رسوم متوقعة |
| **Live Preview** | modal تأكيد | §5 |
| **نتيجة النجاح** | toast + تحديث بطاقة | `LO_MSG_AMENDMENT_SUCCESS` |
| **سجل التعديلات** | تبويب في الطلب | §7.1 |
| **التتبع** | `/track` | خريطة · شريط Live Order مضغوط |

**عند كل تعديل ناجح يرى العميل:**

- الإجمالي الجديد
- ملخص التغيير (بند أُضيف / حُذف / موقع)
- رسالة مالية إن وُجدت
- رابط «عرض السجل»

**عند الإغلاق يرى:**

- رسالة سببية §8 (ليست «مغلق» فقط)
- زر «تتبع الطلب» بديل

---

### 4.2 المطعم (Restaurant Portal)

| الشاشة | المسار | المحتوى |
|--------|--------|---------|
| **لوحة الطلبات** | `merchant-dashboard.html` | بطاقة الطلب · شارة «تم التعديل» |
| **تفاصيل الطلب** | modal / panel | breakdown محدّث · `#تعديل` |
| **إشعار inline** | portal notifications | ملخص التعديل |

**عند كل تعديل:**

| نوع التعديل | ما يرى المطعم |
|-------------|---------------|
| `add_item` | «أُضيف: {name} × {qty}» · إجمالي جديد |
| `remove_item` | «حُذف: {name}» |
| `change_qty` | «{name}: {old} → {new}» |
| `change_destination` | عنوان جديد (إن يؤثر على التوصيل) |
| `change_notes` | النص الجديد |

**لا يرى:** تفاصيل محفظة العميل · فروقات الدفع الداخلية.

---

### 4.3 المتجر (Store Portal)

مماثل للمطعم §4.2 +:

| إضافة | المحتوى |
|-------|---------|
| `change_pickup_time` | وقت الاستلام الجديد في البطاقة |
| طلبات `pickup_only` | بدون قسم موقع |

---

### 4.4 مزود الخدمة (Service / Gas Provider)

| الشاشة | المحتوى |
|--------|---------|
| `services-provider.html` | طلب محدّث |
| تفاصيل | موعد · وصف · خدمات فرعية |

**عند كل تعديل:**

| نوع | العرض |
|-----|-------|
| `change_schedule` | موعد قديم → جديد |
| `change_description` | diff نص |
| `add_sub_service` | بند فرعي جديد + سعر |

**لا يرى:** تعديلات بنود مطعم/متجر.

---

### 4.5 المندوب (Driver)

| الشاشة | المحتوى |
|--------|---------|
| `driver.html` | بطاقة المهمة |
| الخريطة | مسار محدّث |

**عند كل تعديل — يرى فقط:**

| نوع | العرض |
|-----|-------|
| `change_destination` | «تغيير موقع التسليم» · عنوان · خريطة |
| غير ذلك | **لا إشعار** |

**لا يرى:** إضافة/حذف بنود · فروقات مالية · ملاحظات.

---

### 4.6 الإدارة (Admin)

| الشاشة | المسار | المحتوى |
|--------|--------|---------|
| **تفاصيل الطلب** | `admin/modules/orders.js` | تبويب **Live Order** |
| **Timeline** | نفس التبويب | كل amendment · actor · payload |
| **سياسات** | Admin → `capability-rules` · `experience-rules` |
| **تقارير** | finance | تعديلات مالية · استثناءات |

**عند كل تعديل — ترى الإدارة:**

| الشرط | المحتوى |
|-------|---------|
| delta ≠ 0 | المبلغ · الاتجاه · حالة السداد |
| delta > حد (config) | تنبيه `admin.live_order.financial` |
| force lock/unlock | سجل audit كامل |
| تعارض / فشل | `admin.live_order.exception` |

---

## 5. Live Preview — شاشة المعاينة

### 5.1 قاعدة إلزامية

```text
لا POST apply بدون preview_id صالح + تأكيد صريح من العميل
```

### 5.2 تخطيط الشاشة

```text
┌─────────────────────────────────────────────┐
│  معاينة التعديل                        [×] │
├─────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐       │
│  │ قبل التعديل  │    │ بعد التعديل  │       │
│  │ 95.00 ر.س   │ →  │ 78.00 ر.س   │       │
│  │ • بند أ      │    │ • بند أ      │       │
│  │ • بند ب      │    │ (حُذف بند ب) │       │
│  └──────────────┘    └──────────────┘       │
├─────────────────────────────────────────────┤
│  💰 الفرق المالي                            │
│  ┌─────────────────────────────────────────┐│
│  │ سيتم تحويل 17 ريال إلى محفظتك.        ││
│  └─────────────────────────────────────────┘│
│  طريقة التسوية: إيداع محفظة ERVENOW         │
├─────────────────────────────────────────────┤
│  ⏱ صالحة حتى 12:05 (5 دقائق)               │
├─────────────────────────────────────────────┤
│  [ إلغاء ]              [ تأكيد التعديل ]  │
└─────────────────────────────────────────────┘
```

### 5.3 عناصر إلزامية

| العنصر | الوصف |
|--------|--------|
| **قبل** | `breakdown_summary` · `total` · `delivery_fee` |
| **بعد** | نفس الحقول بعد التطبيق المحاكى |
| **diff بصري** | تمييز أخضر (إضافة) · أحمر (حذف) · محايد (موقع) |
| **الفرق المالي** | `delta` · `direction` · `message_ar` |
| **طريقة التسوية** | محفظة · COD · بوابة · لا يوجد |
| **TTL** | عداد 5 دقائق — انتهاء = إعادة preview |
| **تأكيد** | زر primary — `min-height: 48px` |
| **إلغاء** | يغلق دون تغيير |

### 5.4 حالات خاصة في Preview

| الحالة | العرض |
|--------|-------|
| delta = 0 | `LO_MSG_NO_FINANCIAL_DIFF` |
| delta > 0 + رصيد محفظة غير كافٍ | تحذير + خيار شحن أو COD |
| نافذة أُغلقت أثناء Preview | `LO_MSG_WINDOW_CLOSED` — إغلاق modal |
| `payment_required` | خطوة دفع قبل Apply |

### 5.5 رسالة التأكيد النهائية (بعد Apply)

```text
تم تطبيق التعديل بنجاح.
الإجمالي الجديد: {total} ر.س
{financial_message}
```

---

## 6. Wallet Flow — Settlement Engine

> **Settlement Engine** ينفّذ جميع حركات الفروقات المالية — انظر [Naming Standard](./ERVENOW-NAMING-STANDARD-v1.0.md).

### 6.1 زيادة قيمة الطلب (delta > 0)

```text
[حساب delta في Preview]
        ↓
[العميل يؤكد]
        ↓
┌───────────────────┐
│ طريقة الدفع الأصلية │
└─────────┬─────────┘
          │
    ┌─────┼─────┬─────────────┐
    ▼     ▼     ▼             ▼
 wallet  COD  ew_pay    card/gateway
    │     │     │             │
    ▼     ▼     ▼             ▼
 خصم   تسجيل  خصم      جلسة دفع
 فوري  cod_    hold      (Phase 4)
       outstanding  إعادة
                  حساب
    │     │     │             │
    └─────┴─────┴─────────────┘
                  ↓
         [نجاح] → amendment: applied
                  → breakdown محدّث
                  → LO_MSG_CHARGE_SUCCESS
                  ↓
         [فشل] → amendment: pending_payment
                  → breakdown بدون تغيير §10.1
```

| طريقة | السلوك | رسالة نجاح |
|-------|--------|------------|
| **محفظة / ew_pay** | خصم ذري فوري | `LO_MSG_CHARGE_WALLET_SUCCESS` |
| **COD** | `cod_outstanding += delta` | `LO_MSG_CHARGE_COD` |
| **بطاقة** | payment session | `LO_MSG_PAYMENT_SESSION` |
| **رصيد غير كافٍ** | رفض أو عرض شحن | `LO_MSG_INSUFFICIENT_BALANCE` |

### 6.2 نقصان قيمة الطلب (delta < 0)

```text
[حساب |delta| في Preview]
        ↓
[العميل يؤكد]
        ↓
[credit_customer_wallet(|delta|)]  — RPC ذري
        ↓
[تسجيل order_amendment_ledger_entry]
        ↓
[amendment: applied · payment_status: credited]
        ↓
[LO_MSG_CREDIT_WALLET_SUCCESS]
```

| البند | التفصيل |
|-------|---------|
| **الوجهة** | محفظة ERVENOW التشغيلية للعميل |
| **التوقيت** | فوري عند Apply |
| **تسوية تاجر** | تُؤجَّل لـ `delivered` على الإجمالي النهائي |
| **إشعار** | `customer.live_order.financial` |

### 6.3 بدون فرق (delta = 0)

- Apply مباشر بعد Preview
- لا حركة محفظة
- `payment_status: n/a`

### 6.4 ملخص حالات `payment_status`

| القيمة | المعنى | يراها العميل |
|--------|--------|--------------|
| `n/a` | لا فرق مالي | — |
| `paid` | تم خصم الزيادة | «تم الدفع» |
| `credited` | أُودع في المحفظة | «أُضيف للمحفظة» |
| `pending` | بانتظار دفع | «بانتظار الدفع» + CTA |
| `failed` | فشل الدفع | «فشل الدفع» + إعادة محاولة |
| `cod_outstanding` | يُحصّل عند التسليم | «يُضاف عند الاستلام» |

---

## 7. سجل التعديلات

### 7.1 سجل العميل

**المسار:** `/my-orders/:orderId/amendments` أو تبويب «سجل التعديلات»

| العمود | المصدر | مثال عرض |
|--------|--------|----------|
| **الوقت** | `applied_at` | 3 يوليو 2026 · 12:04 م |
| **النوع** | `amendment_type` | «حذف صنف» |
| **قبل** | `payload.before_summary` | 95.00 ر.س · 3 بنود |
| **بعد** | `payload.after_summary` | 78.00 ر.س · 2 بنود |
| **الفرق** | `financial_delta` | −17.00 ر.س |
| **السداد** | `payment_status` | «أُضيف للمحفظة» |

**ترتيب:** الأحدث أولاً · pagination 20

**حالة فارغة:** «لم يُجرَ أي تعديل على هذا الطلب بعد»

### 7.2 سجل الإدارة

**المسار:** Admin → Orders → تفاصيل → تبويب Live Order

| الحقل | المرئية |
|-------|---------|
| `amendment_number` | #1, #2, … |
| `amendment_type` | كود + وصف |
| `payload` JSONB كامل | قبل/بعد تفصيلي |
| `financial_delta` | +/− |
| `financial_direction` | credit_wallet · … |
| `payment_status` | |
| `requested_by` | user_id · دور |
| `idempotency_key` | |
| `lock_reason_at_apply` | |
| ledger refs | روابط حركات |

**إجراءات Admin:**

- Force lock / unlock (مع سبب + audit)
- عرض amendment `pending_payment`
- تصدير CSV (Phase 7)

---

## 8. فهرس الرسائل (i18n)

> **جميع الرسائل عبر مفاتيح ترجمة** — `shared/messages/liveOrder.js` (مقترح).  
> الصيغة: `LO_MSG_{KEY}` · المعاملات: `{amount}` · `{total}` · `{name}`

### 8.1 رسائل الإغلاق (Closure)

| المفتاح | العربية (افتراضي) |
|---------|-------------------|
| `LO_MSG_MERCHANT_PREPARING` | بدأ المطعم تجهيز طلبك، لذلك لم يعد بالإمكان تعديل الأصناف. |
| `LO_MSG_MERCHANT_READY` | طلبك جاهز للتسليم — التعديل على الأصناف مغلق. |
| `LO_MSG_DRIVER_PICKUP` | استلم المندوب الطلب، ويمكنك الآن متابعة رحلة التوصيل. |
| `LO_MSG_DRIVER_DELIVERING` | المندوب في الطريق إليك — يمكنك متابعة التوصيل فقط. |
| `LO_MSG_DESTINATION_AFTER_PICKUP` | لا يمكن تعديل الموقع بعد استلام المندوب للطلب. |
| `LO_MSG_SERVICE_IN_PROGRESS` | بدأ تنفيذ الخدمة — بعض التعديلات لم تعد متاحة. |
| `LO_MSG_PROVIDER_ACCEPTED` | قبل مزود الخدمة طلبك — التعديل محدود حسب السياسة. |
| `LO_MSG_PAYMENT_PENDING` | يوجد تعديل بانتظار الدفع — أكمل الدفع أو ألغِ التعديل. |
| `LO_MSG_MAX_AMENDMENTS` | وصلت للحد الأقصى من التعديلات على هذا الطلب. |
| `LO_MSG_EXTERNAL_POS_LOCKED` | هذا الطلب مرتبط بنظام خارجي — التعديل غير متاح. |
| `LO_MSG_ADMIN_FORCE_LOCK` | تم إغلاق التعديل من الدعم — تواصل معنا للمساعدة. |

### 8.2 رسائل النجاح

| المفتاح | العربية |
|---------|---------|
| `LO_MSG_AMENDMENT_SUCCESS` | تم تطبيق التعديل بنجاح. |
| `LO_MSG_ITEM_ADDED_SUCCESS` | تمت إضافة المنتج بنجاح. |
| `LO_MSG_ITEM_REMOVED_SUCCESS` | تم حذف الصنف بنجاح. |
| `LO_MSG_DESTINATION_UPDATED` | تم تحديث موقع التسليم. |
| `LO_MSG_SCHEDULE_UPDATED` | تم تحديث موعد الخدمة. |

### 8.3 رسائل مالية (Preview + نتيجة)

| المفتاح | العربية |
|---------|---------|
| `LO_MSG_CREDIT_WALLET` | سيتم تحويل **{amount}** ريال إلى محفظتك. |
| `LO_MSG_CREDIT_WALLET_SUCCESS` | تم تحويل **{amount}** ريال إلى محفظتك. |
| `LO_MSG_CHARGE_WALLET` | سيتم تحصيل **{amount}** ريال كمبلغ إضافي. |
| `LO_MSG_CHARGE_WALLET_SUCCESS` | تم خصم **{amount}** ريال من محفظتك. |
| `LO_MSG_CHARGE_COD` | سيُضاف **{amount}** ريال إلى المبلغ المستحق عند التسليم. |
| `LO_MSG_PAYMENT_SESSION` | سيتم فتح جلسة دفع بقيمة **{amount}** ريال. |
| `LO_MSG_NO_FINANCIAL_DIFF` | لا يوجد فرق مالي — سيتم تطبيق التعديل مباشرة. |
| `LO_MSG_INSUFFICIENT_BALANCE` | رصيد المحفظة غير كافٍ. الرجاء الشحن أو اختيار الدفع عند الاستلام. |

### 8.4 رسائل الخطأ

| المفتاح | العربية |
|---------|---------|
| `LO_MSG_WINDOW_CLOSED` | انتهت فترة التعديل على هذا الطلب. |
| `LO_MSG_PREVIEW_EXPIRED` | انتهت صلاحية المعاينة — الرجاء المحاولة مجدداً. |
| `LO_MSG_CONFLICT` | تغيّرت حالة الطلب — أعد المعاينة من جديد. |
| `LO_MSG_PAYMENT_FAILED` | فشل سداد المبلغ الإضافي — لم يُطبَّق التعديل. |
| `LO_MSG_MERCHANT_REJECTED` | رفض الشريك التعديل — {reason} |
| `LO_MSG_NETWORK_ERROR` | تعذّر الاتصال — تحقق من الشبكة وحاول مجدداً. |
| `LO_MSG_ACTION_NOT_ALLOWED` | هذا التعديل غير متاح لهذا النوع من الطلب. |
| `LO_MSG_PROFILE_NO_QUANTITY` | لا يمكن تعديل الكمية لهذا النوع من الخدمة. |

### 8.5 Smart Lock (Phase 6)

| المفتاح | العربية |
|---------|---------|
| `LO_MSG_PARTIAL_LOCK_ADD_ONLY` | يمكنك إضافة مشروبات وسلطات فقط — بدأ تجهيز باقي الطلب. |
| `LO_MSG_ITEM_LOCKED` | لا يمكن تعديل «{name}» — بدأ تجهيزه. |

---

## 9. الإشعارات — Smart Routing

### 9.1 المبدأ

```text
كل طرف يستقبل ما يخصه فقط — لا إشعارات عامة لجميع التعديلات
```

### 9.2 مصفوفة التوجيه الكاملة

| الحدث | العميل | تاجر | مزود | مندوب | إدارة |
|-------|:------:|:----:|:----:|:-----:|:-----:|
| تعديل ناجح (عام) | ✅ | — | — | — | — |
| delta ≠ 0 | ✅ | — | — | — | ✅* |
| تغيير بنود | ✅ ملخص | ✅ تفصيل | — | — | — |
| تغيير موقع | ✅ | ⚠️ | — | ✅ | — |
| تغيير موعد (خدمة) | ✅ | — | ✅ | — | — |
| إغلاق نافذة | ✅ | ✅ | ⚠️ | ⚠️ | — |
| فشل دفع | ✅ | — | — | — | ✅ |
| تعارض / استثناء | ✅ | ✅ | ✅ | ✅ | ✅ |
| تدخل Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل ملاحظات فقط | — | ✅ | — | — | — |

\* إدارة: فقط إن `|delta| > ADMIN_FINANCIAL_ALERT_THRESHOLD`

### 9.3 قنوات الإشعار

| القناة | الاستخدام |
|--------|-----------|
| **in-app** | افتراضي لجميع الأطراف |
| **push** | مندوب (موقع) · عميل (مالي) — Phase لاحقة |
| **WhatsApp** | اختياري — تغيير موقع للمندوب · تأكيد مالي للعميل |
| **Socket** | `broadcastOrderPatch` — تحديث فوري للواجهات المفتوحة |

### 9.4 أحداث النظام (event keys)

| event | المستلم |
|-------|---------|
| `customer.live_order.applied` | عميل |
| `customer.live_order.financial` | عميل |
| `customer.live_order.locked` | عميل |
| `merchant.live_order.items` | تاجر |
| `service.schedule.updated` | مزود |
| `driver.live_order.destination` | مندوب |
| `admin.live_order.financial` | إدارة |
| `admin.live_order.exception` | إدارة |

---

## 10. حالات الفشل والاستثناء

### 10.1 فشل سداد الفرق

| المرحلة | السلوك |
|---------|--------|
| Apply | amendment → `pending_payment` |
| `breakdown` | **بدون تغيير** |
| واجهة العميل | `LO_MSG_PAYMENT_FAILED` + زر «إعادة الدفع» / «إلغاء التعديل» |
| إشعار | `customer.live_order.financial` + `admin.live_order.exception` |
| انتهاء TTL دفع | amendment → `rejected` تلقائياً |

### 10.2 انتهاء نافذة التعديل أثناء التنفيذ

| النقطة | السلوك |
|--------|--------|
| أثناء Preview | modal إغلاق + `LO_MSG_WINDOW_CLOSED` |
| بين Preview و Apply | `409` + `LO_MSG_CONFLICT` |
| أثناء Apply (نادر) | rollback · amendment `rejected` |

### 10.3 تعارض تعديلين متزامنين

| السيناريو | المعالجة |
|-----------|----------|
| عميلان نفس الحساب | نادر — نفس `amendment_version` |
| عميل + تاجر يغيّر الحالة | **Optimistic lock** — الثاني يحصل `409` |
| عميل + Admin force lock | Apply مرفوض · `LO_MSG_ADMIN_FORCE_LOCK` |

```text
Client A: preview (version=3) → apply OK → version=4
Client B: preview (version=3) → apply FAIL 409 → إعادة preview
```

### 10.4 انقطاع الاتصال

| النقطة | السلوك |
|--------|--------|
| أثناء Preview | إعادة محاولة · لا تغيير |
| أثناء Apply | idempotency_key — إعادة Apply آمنة |
| بعد Apply بدون رد | polling `GET amendments` · إن وُجد → نجاح |

### 10.5 رفض الشريك (سياسة اختيارية — Phase 5+)

| الشرط | السلوك |
|-------|--------|
| `requires_merchant_approval: true` | amendment → `pending_approval` |
| التاجر يقبل | متابعة مسار الدفع |
| التاجر يرفض | `rejected` · `LO_MSG_MERCHANT_REJECTED` |
| العميل | لا خصم · لا تغيير |

### 10.6 حدود السياسة

| الحد | السلوك |
|------|--------|
| `max_amendments` | رفض · `LO_MSG_MAX_AMENDMENTS` |
| `max_add_amount` | رفض Preview · رسالة مخصصة |
| cooldown بين التعديلات | `429` · «انتظر {n} ثانية» |

### 10.7 جدول معالجة الأخطاء (API)

| HTTP | code | رسالة العميل |
|------|------|--------------|
| 400 | `INVALID_ACTION` | `LO_MSG_ACTION_NOT_ALLOWED` |
| 403 | `LOCKED` | `reasonMessageAr` من Capability Engine |
| 409 | `VERSION_CONFLICT` | `LO_MSG_CONFLICT` |
| 402 | `PAYMENT_REQUIRED` | `LO_MSG_PAYMENT_FAILED` |
| 410 | `PREVIEW_EXPIRED` | `LO_MSG_PREVIEW_EXPIRED` |
| 429 | `RATE_LIMIT` | cooldown message |
| 503 | `UNAVAILABLE` | `LO_MSG_NETWORK_ERROR` |

---

## 11. Functional Test Cases

> قائمة اختبارات تشغيلية **قبل بدء التطوير الفعلي** — تُنفَّذ يدوياً/E2E عند اكتمال كل Phase.

### 11.1 User Journey

| ID | الحالة | الخطوات | النتيجة المتوقعة |
|----|--------|---------|------------------|
| LO-TC-001 | طلب جديد | إنشاء → فتح طلباتي | زر «إدارة الطلب» ظاهر ونشط |
| LO-TC-002 | window_open | فتح النافذة | إجراءات §3.1 لـ pending |
| LO-TC-003 | Lock | picked_up | زر معطّل + `LO_MSG_DRIVER_PICKUP` |
| LO-TC-004 | delivered | فتح الطلب | لا زر إدارة · سجل متاح |

### 11.2 Decision Matrix — Commerce

| ID | الحالة | الإجراء | متوقع |
|----|--------|---------|-------|
| LO-TC-010 | pending | add_item | ✅ نجاح |
| LO-TC-011 | pending | remove_item | ✅ + credit wallet |
| LO-TC-012 | preparing | remove_item | ❌ 403 |
| LO-TC-013 | preparing | add_item (beverage) | ⚠️ ✅ |
| LO-TC-014 | ready | add_item | ❌ |
| LO-TC-015 | picked_up | change_destination | ❌ |
| LO-TC-016 | accepted | change_destination | ✅ + إشعار مندوب |

### 11.3 Live Preview

| ID | السيناريو | متوقع |
|----|-----------|-------|
| LO-TC-020 | حذف بند | قبل/بعد + delta سالب |
| LO-TC-021 | Apply بدون Preview | ❌ 400 |
| LO-TC-022 | Preview منتهي (>5 دق) | ❌ 410 |
| LO-TC-023 | تأكيد صريح | لا Apply عند إلغاء |

### 11.4 Wallet

| ID | السيناريو | متوقع |
|----|-----------|-------|
| LO-TC-030 | delta −17 · wallet | +17 في المحفظة |
| LO-TC-031 | delta +23 · wallet | −23 من المحفظة |
| LO-TC-032 | delta +23 · COD | cod_outstanding += 23 |
| LO-TC-033 | delta +500 · رصيد ناقص | رفض أو خيارات |
| LO-TC-034 | فشل خصم | breakdown بدون تغيير |

### 11.5 تعارض وحافة

| ID | السيناريو | متوقع |
|----|-----------|-------|
| LO-TC-040 | تغيير حالة أثناء Preview | 409 عند Apply |
| LO-TC-041 | تعديلان متزاميان | واحد 409 |
| LO-TC-042 | idempotency مكرر | نفس النتيجة بدون تكرار |
| LO-TC-043 | انقطاع بعد Apply | polling يؤكد |

### 11.6 إشعارات

| ID | السيناريو | مستلم | متوقع |
|----|-----------|--------|-------|
| LO-TC-050 | add_item | تاجر | ✅ · مندوب ❌ |
| LO-TC-051 | change_destination + مندوب | مندوب | ✅ |
| LO-TC-052 | change_notes | تاجر | ✅ · عميل ❌* |

\* عميل يرى النجاح في الواجهة — لا إشعار منفصل إن delta=0.

### 11.7 عموديات

| ID | العمودية | السيناريو | متوقع |
|----|----------|-----------|-------|
| LO-TC-060 | service | change_schedule | ✅ + إشعار مزود |
| LO-TC-061 | transport | change_destination قبل on_the_way | ✅ |
| LO-TC-062 | gas | تعديل بعد قبول مزود | ❌ |
| LO-TC-063 | pickup | change_destination | — غير منطبق |

### 11.8 Service Profiles

| ID | السيناريو | متوقع |
|----|-----------|-------|
| LO-TC-090 | طلب `home_service` + `add_item` | ❌ — source: profile |
| LO-TC-091 | طلب `gas` + `change_qty` لترات | ✅ — quantity_model: liters |
| LO-TC-092 | طلب `car_transport` + `change_qty` | ❌ — quantity_model: none |
| LO-TC-093 | `pharmacy` + منتج بوصفة | ⚠️ حسب constraints |
| LO-TC-094 | order_type جديد بلا profile | ❌ + alert Admin |

### 11.9 Admin

| ID | السيناريو | متوقع |
|----|-----------|-------|
| LO-TC-070 | عرض timeline | كل amendments |
| LO-TC-071 | force lock | عميل مرفوض + audit |
| LO-TC-072 | تعديل سياسة تاجر | override §3 |

### 11.10 Responsive (قاعدة EPPC)

| ID | العرض | متوقع |
|----|-------|-------|
| LO-TC-080 | 320px | Live Preview readable · أزرار 48px |
| LO-TC-081 | 768px | sheet/modal متوسط |
| LO-TC-082 | 1280px | desktop — نفس الوظائف |

---

## 12. ربط LOFS بمراحل التنفيذ

| Phase | أقسام LOFS المعنية | Test Cases |
|-------|---------------------|------------|
| **0** | §0.3 · §3.0 · §3.0.1 · §8 (مفاتيح) | LO-TC-090–094 |
| **1** | §1 · §2.2 LO-SC-003 · §4 · §5 · §9 | LO-TC-001–016 · 020–023 |
| **2** | §2 LO-SC-002 · §6.2 · §7 | LO-TC-011 · 030 · 050 |
| **3** | §2 LO-SC-001 · §6.1 | LO-TC-010 · 031–034 |
| **4** | §6 كامل | LO-TC-030–034 |
| **5** | §3 override · §10.5 | LO-TC-072 |
| **6** | §2 LO-SC-020 · Smart Lock | LO-TC-013 |
| **7** | §2.9 · جميع العموديات | LO-TC-060–063 |

---

## 13. قرار التنفيذ

| الترتيب | المخرج | الحالة |
|---------|--------|--------|
| 1 | **LOFS v1.0** (هذه الوثيقة) | معروض للاعتماد |
| 2 | ADR-001 — Live Order Engine | بعد اعتماد LOFS |
| 3 | OpenAPI Specification | بعد ADR |
| 4 | Phase 0 | بعد OpenAPI |
| 5 | بدء التطوير البرمجي | بعد Phase 0 |

```text
لا Migration · لا API · لا واجهات Live Order قبل اعتماد LOFS
```

---

## 14. مستندات مرتبطة

| المستند | العلاقة |
|---------|---------|
| [ERVENOW-NAMING-STANDARD-v1.0.md](./ERVENOW-NAMING-STANDARD-v1.0.md) | معيار التسمية الرسمي |
| [ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md](./ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md) | المعمارية v2.2 |
| [order-lifecycle.md](./order-lifecycle.md) | حالات fulfillment |
| [wallet-system.md](./wallet-system.md) | مسارات مالية |
| [ERVENOW-3.0-EXPERIENCE-ENGINEERING-DIRECTIVE.md](./ERVENOW-3.0-EXPERIENCE-ENGINEERING-DIRECTIVE.md) | تجربة حية |

---

**الخطوة التالية:** اعتماد LOFS → ADR-001 → OpenAPI → Phase 0.
