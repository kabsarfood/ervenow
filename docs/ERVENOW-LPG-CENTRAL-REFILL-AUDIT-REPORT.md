# ERVENOW LPG Central Refill Audit Report

**تاريخ التدقيق:** 2026-06-20  
**النطاق:** خدمة **تعبئة الغاز المسال المركزي** (`gas_central_refill` / `gas_mode=central_refill`) — حالة التنفيذ الفعلية في الكود قبل الاعتماد النهائي داخل Service Portal.

---

## ملخص تنفيذي

| السؤال | الجواب |
|--------|--------|
| **هل الخدمة موجودة؟** | **نعم — جزئياً.** مُعرَّفة في Backend + DB + صفحة عميل واحدة؛ **ليست** مسمّاة `bulk_gas_refill` أو `lpg_refill`. |
| **حالة التنفيذ** | **Backend ~80%** · **Customer UI ~70%** · **Service Portal ~30%** · **Live E2E: غير مجرب** |
| **السعر الحالي** | **0.90 ر.س/لتر** للعميل — **ليس** 1.00 ر.س/لتر |
| **التسوية** | **لا تطابق** نموذج 0.90 مزود + 0.10 منصة/لتر — تستخدم **7%** من الإجمالي + إيداع **`total_amount` كاملاً** |
| **Service Portal جاهز؟** | **لا** — مزود `gas_central_refill` **مُرفوض** من `/service-preview` ويُوجَّه لـ Transport |
| **التوصية** | إصلاح Routing/UI + Settlement + تسجيل مزود + Live E2E قبل الإنتاج |

---

## 1. Service Inventory — جرد الخدمة

### 1.1 المسميات في النظام

| المسمى | موجود؟ | الاستخدام |
|--------|--------|-----------|
| `gas_central_refill` | ✅ | `users.service_type` — نوع حساب مزود التعبئة المركزي |
| `central_refill` | ✅ | `orders.gas_mode` / `data.gas_mode` — وضع الطلب (ليس `service_type` منفصل) |
| `bulk` | ✅ | Alias في الإشعارات/التسعير (`mode === "bulk"` ≡ `central_refill`) |
| `gas_delivery` | ✅ | `orders.service_type` — **نوع الطلب الموحّد** لأسطوانات ومركزي |
| `bulk_gas_refill` | ❌ | **غير موجود** في أي ملف |
| `lpg_refill` | ❌ | **غير موجود** في أي ملف |
| `lpg_*` | ❌ | **غير موجود** |

### 1.2 Database

| العنصر | الملف / الجدول |
|--------|----------------|
| `orders.gas_mode` | `shared/migration_unification_11_service_bookings_to_orders.sql` |
| `orders.gas_liters` | نفس الملف + `shared/migration_gas_service_and_debts.sql` |
| `users.service_type = gas_central_refill` | `apps/core/routes.js` — `ALLOWED_SERVICE_TYPES` |
| `portal_type = service` (G1-R) | `shared/migration_orders_portal_type.sql` |

### 1.3 APIs

| API | دعم المركزي | الملف |
|-----|-------------|-------|
| `GET /api/services/gas/pricing` | ✅ `central_per_liter: 0.9`, `central_liters[]` | `apps/services/routes.js` |
| `POST /api/services/gas-order` | ✅ `gas_mode=central_refill` + `gas_liters` | `apps/services/routes.js` (deprecated) |
| `POST /api/checkout` → `createServiceOrder` | ✅ | `apps/checkout/service.js`, `shared/services/serviceOrderCreate.js` |
| `GET /api/services/bookings` | ✅ فلترة `gas_mode=central_refill` للمزود | `apps/services/routes.js` |
| `POST /api/services/bookings/:id/reserve` | ✅ | `apps/services/routes.js` |
| `POST /api/services/bookings/:id/complete` | ✅ (بدون تسجيل لترات جديدة) | `apps/services/routes.js` |
| `GET /api/services/me/pricing` | ✅ `central_per_liter: 0.9` | `apps/services/routes.js` |
| `computeUnifiedDeliveryFee("gas_delivery", {mode:"bulk"})` | ✅ | `apps/delivery/unifiedDeliveryPricing.js` |

### 1.4 Frontend

| الشاشة | دعم المركزي | الملف |
|--------|-------------|-------|
| `/gas-delivery.html` | ✅ **الوحيدة** — selector لترات 250–4000 | `ervenow-frontend/gas-delivery.html` |
| `/delivery-services.html?service=gas_delivery` | ❌ **أسطوانات فقط** (`gas_mode: cylinder_swap`) | `ervenow-frontend/delivery-services.html` |
| `/service-preview` | ❌ **يرفض** `gas_central_refill` | `ervenow-frontend/assets/service-preview.js` |
| `/transport-preview` | ⚠️ يعرض طلبات غاز (chip «غاز») | `ervenow-frontend/assets/transport-preview.js` |
| `/services-provider.html` | ✅ legacy — generic gas bookings | `public/services-provider.html` |
| تسجيل مزود (`/login?mode=register`) | ❌ **لا خيار** `gas_central_refill` | `ervenow-frontend/login.html` |

### 1.5 Routing

| الطبقة | `gas_central_refill` → | الملف |
|--------|------------------------|-------|
| **Backend (G1-R)** | `service` portal | `shared/utils/resolvePortalRole.js` |
| **Frontend mirrors** | `transport` → `/transport-preview` | `ervenow-frontend/assets/account-destinations.js`, `role-routing.js` |
| **Portal Framework** | `isTransportType(gas_central_refill) = true` | `ervenow-frontend/assets/portal-framework/portal-operational.js` |
| **Service Preview gate** | **BLOCK** — «حساب نقل — افتح /transport-preview» | `service-preview.js` → `isServiceProfile()` |

```743:748:ervenow-frontend/assets/service-preview.js
  function isServiceProfile(p) {
    var role = String((p && p.role) || "").toLowerCase();
    if (role !== "service") return false;
    var Op = global.ErvenowPortalFramework && ErvenowPortalFramework.Operational;
    if (Op && Op.isTransportType(p.service_type)) return false;
    return true;
  }
```

### 1.6 Pricing (مصدر الحقيقة)

```13:14:shared/utils/gasDeliveryPricing.js
const CENTRAL_PRICE_PER_LITER = 0.9;
const CENTRAL_LITERS = [250, 500, 1000, 2000, 3000, 4000];
```

---

## 2. Customer Journey — مسار العميل

### 2.1 المخطط التشغيلي

```
عضو ERVENOW (role=customer)
    ↓
/gas-delivery.html
    · اختيار «2 — تعبئة غاز مركزي»
    · اختيار اللترات (250 | 500 | 1000 | 2000 | 3000 | 4000)
    · تحديد موقع GPS + جوال
    ↓
ErvenowOrderDraftVertical.commit() — type=gas_delivery, gas_mode=central_refill
    ↓
/checkout.html — POST /api/checkout
    ↓
createServiceOrder() — order_type=gas_delivery, gas_liters=N, delivery_status=new
    ↓
notifyGasDeliveryProviders() — in-app + WA (إن ERVENOW_SERVICE_WA_ON_CREATE=1)
    ↓
[اختياري] gasRadiusExpand 15→20 كم
    ↓
مزود gas_central_refill يحجز → accepted
    ↓
complete (provider) → delivering → complete (customer/legacy) → delivered
    ↓
ledger + wallet credit + service.payment.settled
```

**ملاحظة:** `/delivery-services.html` **لا يوفّر** تعبئة مركزي — فقط أسطوانات.

### 2.2 الشاشات

| # | الشاشة | URL |
|---|--------|-----|
| 1 | طلب تعبئة مركزي | `/gas-delivery.html` |
| 2 | تأكيد/دفع | `/checkout.html` |
| 3 | تتبع | `/track?id=<order_number>` |

### 2.3 APIs

| المرحلة | API |
|---------|-----|
| إنشاء | `POST /api/checkout` (primary) |
| Legacy | `POST /api/services/gas-order` (deprecated) |
| تسعير مرجعي | `GET /api/services/gas/pricing` |
| إتمام (عميل) | `POST /api/services/bookings/:id/complete` (`actor=customer`) |

### 2.4 الحالات

| الحالة | المُحفِّز |
|--------|----------|
| `new` | إنشاء عبر checkout |
| `pending` | إنشاء عبر legacy gas-order |
| `accepted` | reserve من مزود |
| `delivering` | complete بـ `actor=provider` |
| `delivered` | complete بـ `actor=customer` أو `legacy/both` |

**لا توجد** حالة مخصصة «وصل المزود» أو «جاري التعبئة» — نفس machine state لكل الغاز.

### 2.5 الإشعارات (العميل)

| الحدث | القناة | ملاحظة |
|-------|--------|--------|
| واتساب «تم الدفع» | WA | إذا `payment_status=paid` |
| واتساب «تم قبول الطلب» | WA | عند reserve |
| واتساب تقييم | WA | عند finalized |
| `customer.order.*` in-app | — | **غير مضمون** لمسار service-only (انظر Legacy Gas Report) |

---

## 3. Provider Journey — مسار مزود التعبئة

### 3.1 الحساب

| الحقل | القيمة |
|-------|--------|
| `role` | `service` |
| `service_type` | `gas_central_refill` |
| التسجيل الذاتي | ❌ **غير متاح** في `login.html` — يحتاج إنشاء admin/API |

### 3.2 استقبال الطلب

1. `notifyGasDeliveryProviders()` يجلب مزودين `role=service` ضمن نطاق 15/20 كم.
2. `providerMatchesBookingType("gas_central_refill", "gas_delivery", "central_refill")` → **true** فقط إذا `gas_mode=central_refill`.
3. مزود `gas_cylinder_swap` **لا يرى** طلبات المركزي (فلتر `mode !== central_refill`).

```48:56:shared/utils/serviceProviderTypes.js
function providerMatchesBookingType(providerType, bookingType, bookingGasMode) {
  ...
  if (gasFilter === "cylinder_swap") return mode !== "central_refill";
  return mode === "central_refill";
}
```

### 3.3 قبول المهمة

- **أين:** `/transport-preview` · `/services-provider.html` · (ليس `/service-preview`)
- **API:** `POST /api/services/bookings/:id/reserve`
- **شروط:** GPS مزود · داخل نطاق الكيلومترات · `gas_mode=central_refill`
- **النتيجة:** `accepted` + `provider_id`

### 3.4 الوصول للموقع

- `POST /api/services/bookings/:id/location` — تحديث `driver_lat/lng` (اسم حقل legacy)
- **لا** حالة `arrived` · **لا** UI «وصلت للموقع»

### 3.5 تسجيل كمية التعبئة

| السؤال | الجواب |
|--------|--------|
| هل يُسجَّل لتر فعلي عند الإتمام؟ | **لا** |
| أين تُحدَّد الكمية؟ | **عند إنشاء الطلب فقط** — `gas_liters` + `orders.data` |
| هل يمكن تعديل اللترات بعد الحجز؟ | **لا API** مخصص |

**فجوة تشغيلية:** لا يوجد capture للكمية الفعلية المُ suministra vs المطلوبة.

### 3.6 إنهاء المهمة

```
POST /api/services/bookings/:id/complete
  actor=provider → delivering
  actor=customer أو legacy → delivered
```

اختصار legacy: رابط WA `/api/driver/complete-order/:id` (لا يمر عبر Driver Portal dispatch).

### 3.7 التسوية المالية

عند `delivered`:
- `settleCompletedServiceLedgerOnly()`
- `creditProviderOnDelivered()` → `ervenow_ledger_credit(provider_id, total_amount, order_id)`
- إشعار `service.payment.settled` (أو `transport.payment.settled` إذا `portal_type` تاريخي)

---

## 4. Pricing Audit — التسعير

### 4.1 السعر الحالي

| البند | القيمة في الكود |
|-------|-----------------|
| **سعر العميل** | **0.90 ر.س/لتر** (`CENTRAL_PRICE_PER_LITER = 0.9`) |
| **الشرائح** | 250 · 500 · 1000 · 2000 · 3000 · 4000 لتر |
| **أمثلة UI** | 250→225 · 500→450 · 1000→900 · 2000→1800 · 3000→2700 · 4000→3600 ر.س |

```170:180:ervenow-frontend/gas-delivery.html
          <div class="gd-subopts" id="gdCentralBox" hidden>
            ...
              <select id="gdLiters">
                <option value="250">250 لتر — 225 ر.س</option>
                <option value="500">500 لتر — 450 ر.س</option>
                ...
```

**لا يوجد** سعر 1.00 ر.س/لتر في أي ملف.

### 4.2 آلية التسعير

| النوع | المركزي |
|-------|---------|
| **آلية** | **ثابت per-liter × شرائح محددة** |
| **ليس** | dynamic distance · tiered discount · admin override per provider |
| **التخزين** | Hardcoded في `shared/utils/gasDeliveryPricing.js` + mirror في `gas-delivery.html` (`PER_LITER = 0.9`) |
| **API exposure** | `GET /api/services/gas/pricing` · `GET /api/services/me/pricing` |

### 4.3 عمولة المنصة (المركزي)

```41:46:shared/utils/gasDeliveryPricing.js
function computeGasPlatformCommission(gasMode, qtyRaw, _litersRaw, totalAmount) {
  const mode = String(gasMode || "cylinder_swap").trim().toLowerCase();
  if (mode === "central_refill" || mode === "bulk") {
    const { computePlatformCommission } = require("./platformCommission");
    return computePlatformCommission(totalAmount);
  }
```

- **النسبة:** 7% افتراضي (`PLATFORM_COMMISSION_RATE = 0.07`) — قابل للتجاوز بـ `ERVENOW_PLATFORM_COMMISSION_RATE`
- **ليس** 0.10 ر.س/لتر ثابت

---

## 5. Settlement Audit — التسوية المالية

### 5.1 مقارنة بالنموذج المطلوب (مثال المستخدم)

| | **مثال المستخدم** | **الكود الفعلي** |
|---|-------------------|------------------|
| سعر العميل/لتر | 1.00 ر.س | **0.90 ر.س** |
| حصة المزود/لتر | 0.90 ر.س | **لا constant** — `provider_net = total × 93%` (7% commission) |
| حصة المنصة/لتر | 0.10 ر.س | **0.063 ر.س** (7% × 0.90) |
| آلية | fixed split/liter | **percent of total** |

### 5.2 حساب `provider_net` عند الإنشاء (checkout path)

```188:192:shared/services/serviceOrderCreate.js
        provider_net:
          serviceType === "gas_delivery" &&
          String((raw.gas_mode ?? payloadData.gas_mode) || "cylinder_swap").toLowerCase() !== "central_refill"
            ? gasCylinderProviderNet(...)
            : Math.max(0, Math.round((total - platformCommission) * 100) / 100),
```

**مثال 1000 لتر @ 0.90:**

| البند | القيمة |
|-------|--------|
| `total_amount` | 900.00 ر.س |
| `platform_commission` (7%) | 63.00 ر.س |
| `data.provider_net` | 837.00 ر.س |

### 5.3 الإيداع الفعلي في المحفظة

```19:38:shared/services/providerLedgerCredit.js
  const amount = orderTotalAmount(order);  // orders.total_amount
  ...
  await sb.rpc("ervenow_ledger_credit", { p_user_id: providerId, p_amount: amount, p_reference: orderId });
```

| البند | القيمة |
|-------|--------|
| **المُ credited** | **`total_amount` = 900.00** (كامل مبلغ العميل) |
| **`provider_net` في data** | 837.00 — **مُخزَّن للمرجعية فقط، لا يُستخدم في RPC** |

### 5.4 الحكم

| التحقق | النتيجة |
|--------|---------|
| نموذج 1.00 → 0.90 → 0.10 per liter | ❌ **غير مُنفَّذ** |
| نموذج 0.90 عميل + 7% منصة | ⚠️ **مُعرَّف جزئياً** في `platform_commission` و `provider_net` |
| إيداع محفظة = حصة المزود | ❌ **FAIL** — يُودَع الإجمالي |

**فجوة حرجة:** التسوية لا تطابق لا نموذج المستخدم ولا `provider_net` المُخزَّن.

---

## 6. Service Portal Readiness — جاهزية البوابة

### 6.1 ما يعمل (Backend)

| العنصر | الحالة |
|--------|--------|
| إنشاء طلب `central_refill` | ✅ |
| فلترة مزود `gas_central_refill` | ✅ |
| reserve / complete / location | ✅ |
| notify cascade | ✅ |
| `portal_type=service` (G1-R) | ✅ |
| wallet withdraw (`role=service`) | ✅ |

### 6.2 ما ينقص / معطّل

| العنصر | الحالة | التفصيل |
|--------|--------|---------|
| **Service Portal UI** | ❌ | `gas_central_refill` مُصنَّف Transport → **blocked** من `/service-preview` |
| **Routing Frontend** | ❌ | `account-destinations.js`, `role-routing.js` → `/transport-preview` |
| **عرض اللترات في البطاقة** | ❌ | `service-preview.js` لا يعرض `gas_mode`/`gas_liters` |
| **Pricing UI (Service)** | ⚠️ | `/me/pricing` يعرض `central_per_liter` لكن Service Portal لا pricing section للغاز |
| **تسجيل مزود** | ❌ | `gas_central_refill` غير موجود في `REGISTER_ROLE_OPTIONS` |
| **Live provider** | ❌ | `data/g1r-live-service-verify.json`: `no_service_provider_in_db` |
| **تسجيل لترات فعلية** | ❌ | لا API/UI |
| **Settlement صحيح** | ❌ | انظر §5 |
| **Customer entry موحّد** | ⚠️ | المركزي فقط في `/gas-delivery.html` — ليس hub الرئيسي |
| **Tests** | ❌ | لا unit tests لـ `central_refill` |

### 6.3 أين يعمل المزود اليوم فعلياً؟

1. **`/transport-preview`** — Portal 2.0 مع chip «غاز» (تصنيف legacy)
2. **`/services-provider.html`** — لوحة legacy generic

---

## 7. Live Readiness Score

| العنصر | PASS / FAIL | السبب |
|--------|-------------|-------|
| **Routing** | **FAIL** | Backend→service ✅ · Frontend→transport ❌ · Service Preview blocks gas_central_refill |
| **Orders** | **PASS** | APIs تدعم `central_refill` + `gas_liters` + reserve/complete |
| **Pricing** | **PASS** | 0.90/liter + 6 شرائح مُعرَّفة ومُ exposed — لكن **لا** admin edit |
| **Wallet** | **PASS** | `ervenow_ledger_credit` + withdraw APIs لـ `role=service` |
| **Settlement** | **FAIL** | credits `total_amount`؛ لا fixed per-liter split؛ لا match لـ `provider_net` |
| **Notifications** | **PASS** | `notifyGasDeliveryProviders` + in-app + reserve WA |
| **Service Portal** | **FAIL** | blocked entry · no central UI · no registration · no live provider · frontend drift |

**النتيجة الإجمالية: 4 PASS / 3 FAIL — غير جاهز للإنتاج في Service Portal.**

---

## 8. التوصيات للتشغيل الإنتاجي

### P0 — قبل أي go-live

1. **إصلاح Routing Frontend** — نقل `gas_central_refill` من `TRANSPORT_SERVICE_TYPES` إلى Service في:
   - `account-destinations.js`
   - `role-routing.js`
   - `portal-operational.js` (`isTransportType`)
   - إزالة gas من `transport-preview.js`

2. **فتح Service Portal** — تعديل `isServiceProfile()` / `portal-operational.js` لقبول `gas_central_refill`.

3. **إصلاح Settlement** — قرار product:
   - **إما** تطبيق نموذج per-liter (مثلاً 0.90 مزود + 0.10 منصة على 1.00 عميل)
   - **إما** الإبقاء على 0.90 عميل + 7% وتعديل `creditProviderOnDelivered` لاستخدام `data.provider_net`
   - **لا تُودِع** `total_amount` كاملاً إذا المنصة تحتفظ بعمولة

4. **إنشاء مزود live** — `role=service`, `service_type=gas_central_refill`, GPS + موافقة admin.

5. **Live E2E** — central_refill: create → notify → reserve → complete → settlement verify.

### P1 — تجربة مزود/عميل

6. **UI Service Portal** — بطاقة طلب تعرض: `gas_mode`, `gas_liters`, label «تعبئة مركزي», خريطة.

7. **تسجيل مزود** — إضافة `{ value: "gas_central_refill", label: "⛽ تعبئة غاز مركزي" }` في `login.html` `REGISTER_ROLE_OPTIONS`.

8. **Customer hub** — إضافة central refill option في `/delivery-services.html` أو redirect واضح إلى `/gas-delivery.html`.

### P2 — نضج تشغيلي

9. **تسجيل كمية فعلية** (optional) — API field `actual_liters_delivered` عند complete.

10. **Unit tests** — `priceCentralRefill`, `providerMatchesBookingType`, settlement central path.

11. **توحيد التسعير** — إزالة duplicate `PER_LITER=0.9` من HTML؛ consume API only.

---

## 9. ملحق — جدول أسعار المركزي (الحالي)

| اللترات | سعر العميل | عمولة 7% | provider_net (data) | credited (wallet) |
|---------|------------|----------|---------------------|-------------------|
| 250 | 225.00 | 15.75 | 209.25 | **225.00** ❌ |
| 500 | 450.00 | 31.50 | 418.50 | **450.00** ❌ |
| 1000 | 900.00 | 63.00 | 837.00 | **900.00** ❌ |
| 2000 | 1800.00 | 126.00 | 1674.00 | **1800.00** ❌ |
| 3000 | 2700.00 | 189.00 | 2511.00 | **2700.00** ❌ |
| 4000 | 3600.00 | 252.00 | 3348.00 | **3600.00** ❌ |

---

## 10. ملفات مرجعية

| المجال | الملفات |
|--------|---------|
| تسعير | `shared/utils/gasDeliveryPricing.js` |
| مزود types | `shared/utils/serviceProviderTypes.js` |
| إنشاء طلب | `shared/services/serviceOrderCreate.js`, `apps/delivery/gasDeliveryCreate.js` |
| APIs | `apps/services/routes.js` |
| عميل UI | `ervenow-frontend/gas-delivery.html` |
| Service Portal | `ervenow-frontend/assets/service-preview.js` |
| Transport (legacy) | `ervenow-frontend/assets/transport-preview.js` |
| Routing | `shared/utils/resolvePortalRole.js`, `ervenow-frontend/assets/account-destinations.js` |
| Settlement | `shared/services/providerLedgerCredit.js`, `shared/services/completeServiceOrder.js` |
| Live verify | `data/g1r-live-service-verify.json` |
| Gas legacy report | `docs/ERVENOW-LEGACY-GAS-WORKFLOW-REPORT.md` |

---

**نهاية التقرير.**  
**الحكم:** خدمة تعبئة الغاز المركزي **موجودة في Backend وصفحة عميل واحدة**، لكنها **غير جاهزة للإنتاج في Service Portal** بسبب Routing/UI/Settlement/Registration gaps.
