# ERVENOW Legacy Gas Workflow Report

**تاريخ التدقيق:** 2026-06-20  
**النطاق:** دورة الغاز كما هي مُنفَّذة في الكود (بدون افتراضات) — من إنشاء الطلب حتى الإغلاق والتسوية.  
**قيود:** لا يُغيَّر تصنيف الغاز التشغيلي أو `portal_type` بناءً على هذا التقرير وحده؛ التقرير وصفي.

---

## ملخص تنفيذي

| المحور | النتيجة |
|--------|---------|
| **محرك التشغيل** | **Service Workflow** — حجز/إتمام عبر `/api/services/bookings/*`، `provider_id`، `completeServiceOrder()` |
| **Driver Workflow** | **لا** — `gas_delivery` مستبعد صراحةً من `driverDispatchOrders` |
| **التصنيف التاريخي للبوابة (قبل G1-R)** | **Transport Portal** — `gas_*` في `TRANSPORT_PORTAL_TYPES`، `portal_type = transport` |
| **التصنيف الحالي في الـ Backend (بعد G1-R)** | **Service Portal** — `gas_*` في `SERVICE_PORTAL_TYPES`، migration → `portal_type = service` |
| **تناقض واجهة متبقٍ** | مرايا Frontend (`account-destinations.js`, `role-routing.js`, `transport-preview.js`) ما زالت تعامل الغاز كـ Transport في بعض المسارات |
| **التوصية** | **الخيار A — Gas → Service Portal** (انظر §7) |

---

## 1. Gas Customer Journey — مسار العميل

### 1.1 المخطط التشغيلي

```
عضو ERVENOW (role=customer)
    ↓
/gas-delivery.html — بناء عنصر سلة type=gas_delivery
    ↓
ErvenowOrderDraftVertical.commit() → مسودة طلب
    ↓
/checkout.html — دفع/تأكيد
    ↓
POST /api/checkout (createServiceOrder)  — المسار الحالي
    أو
POST /api/services/gas-order (createGasDelivery) — مسار legacy مُهمَل
    ↓
orders: order_type=gas_delivery, service_type=gas_delivery
    delivery_status: new (checkout) | pending (gas-order legacy)
    ↓
إشعار مزودي الغاز (in-app + واتساب اختياري)
    ↓
[اختياري] توسيع نطاق البحث 15→20 كم بعد 5 دقائق بدون حجز
    ↓
مزود يحجز → accepted
    ↓
مزود/عميل يُكمل → delivering (خطوة مزود) → delivered
    ↓
تسوية ledger + إيداع محفظة المزود + إشعار service.payment.settled
```

### 1.2 الشاشات

| المرحلة | الشاشة / المكوّن | الملف |
|---------|------------------|-------|
| طلب الغاز | `/gas-delivery.html` | `ervenow-frontend/gas-delivery.html` |
| مسودة الطلب | `ErvenowOrderDraftVertical.commit()` | `ervenow-frontend/assets/order-draft-vertical.js` |
| الدفع والتأكيد | `/checkout.html` | `ervenow-frontend/checkout.html` |
| تتبع الطلب | `/track?id=<order_number>` | `ervenow-frontend/assets/track.js` |
| حساب العضو | `/start-now.html` | `ervenow-frontend/assets/account-destinations.js` |

**ملاحظة:** صفحة الغاز لا تنشئ الطلب مباشرة؛ زر «إضافة للسلة» يبني `cart item` ويحوّل لمسار checkout:

```278:352:ervenow-frontend/gas-delivery.html
        function buildCartItem() {
          ...
          return {
            type: "gas_delivery",
            title: title,
            price: total,
            data: {
              gas_mode: mode,
              gas_liters: liters,
              qty: qty,
              district: document.getElementById("gdDistrict").value.trim(),
              location: document.getElementById("gdLocation").value.trim(),
              customer_phone: document.getElementById("gdPhone").value.trim(),
              total_amount: total,
            },
          };
        }
        ...
          var gdRes = ErvenowOrderDraftVertical.commit(item, {
            sourcePage: "/gas-delivery",
            vertical: "gas",
            message: "تمت إضافة طلب الغاز — أكمل تأكيد الطلب",
          });
```

### 1.3 APIs

| API | الغرض | الحالة |
|-----|-------|--------|
| `POST /api/checkout` | إنشاء الطلب عبر `createServiceOrder()` | **المسار الفعلي من checkout** |
| `POST /api/services/gas-order` | `createGasDelivery()` → `createDeliveryOrderFromBody()` | **Legacy — مُعلَم deprecated** |
| `GET /api/services/gas/pricing` | أسعار أسطوانة/مركزي | مرجع تسعير |
| `GET /api/orders/:id` / track | متابعة الحالة | عميل |
| `POST /api/services/bookings/:id/complete` | تأكيد استلام (role=customer) | إغلاق ثنائي الخطوة |

**مسار Checkout (الحالي):**

```216:231:apps/checkout/service.js
        const created = await createServiceOrder(sb, appUser, {
          order_type: "service",
          service_type: serviceType,
          ...
          gas_mode: data.gas_mode || null,
          gas_liters: data.gas_liters != null ? Number(data.gas_liters) : null,
          total_amount: total,
          payment_status: svcPaymentStatus,
          ...
        });
```

**مسار Legacy المباشر:**

```326:367:apps/services/routes.js
router.post("/gas-order", optionalAuth, async (req, res) => {
    deprecateLegacyOrderRoute(req, res, "POST /api/services/gas-order", UNIFIED_ORDER_CREATE);
    ...
    const { data: gasOrder, error: gasErr } = await createGasDelivery(sb, req.appUser || {...}, {...});
```

### 1.4 شكل الطلب عند الإنشاء

| الحقل | القيمة |
|-------|--------|
| `order_type` | `gas_delivery` |
| `service_type` | `gas_delivery` |
| `order_number` | بادئة `ES` (service order series) |
| `delivery_status` الأولية | `new` (checkout) · `pending` (legacy gas-order) |
| `payment_status` | `paid` أو `unpaid` (COD افتراضي من `/gas-delivery`) |
| `gas_mode` | `cylinder_swap` \| `central_refill` |
| `data.gas_radius_km` | 15 كم ابتدائياً |
| `data.provider_net` | 37 ر.س/أسطوانة (أسطوانات) — يُحسب عند الإنشاء |

```48:51:shared/services/serviceOrderCreate.js
function resolveOrderType(serviceType) {
  const st = String(serviceType || "service").trim().toLowerCase();
  return st === "gas_delivery" ? "gas_delivery" : "service";
}
```

### 1.5 تغييرات حالة الطلب (العميل)

| # | الحالة | المُحفِّز | ملاحظات |
|---|--------|----------|---------|
| 1 | `new` / `pending` | إنشاء الطلب | حالتان تاريخيتان حسب مسار الإنشاء |
| 2 | `accepted` | `POST .../bookings/:id/reserve` (مزود) | `provider_id` يُعيَّن |
| 3 | `delivering` | `POST .../complete` بـ `actor=provider` | تأكيد تنفيذ المزود |
| 4 | `delivered` | `POST .../complete` بـ `actor=customer` أو `legacy/both` | إغلاق + تسوية |

**مسار إغلاق legacy مختصر:** رابط واتساب `/api/driver/complete-order/:id` يستدعي `patchUnifiedOrderStatus(..., delivered)` — يعمل على صفوف `gas_delivery` عبر `completeServiceOrder` ولكن **ليس** عبر بوابة المندوب.

### 1.6 التسعير (العميل)

```3:6:shared/utils/gasDeliveryPricing.js
const GAS_CYLINDER_PROVIDER_NET = 37;
const GAS_CYLINDER_PLATFORM_FEE = 2;
/** سعر العميل للأسطوانة = 37 مزود + 2 منصة */
const GAS_CYLINDER_CUSTOMER_UNIT = GAS_CYLINDER_PROVIDER_NET + GAS_CYLINDER_PLATFORM_FEE;
```

- **أسطوانة:** 39 ر.س/أسطوانة (1–10)
- **مركزي:** 0.9 ر.س/لتر (250–4000 لتر)

---

## 2. Gas Provider Journey — مسار مزود الغاز

### 2.1 المخطط

```
حساب role=service + service_type=gas_cylinder_swap | gas_central_refill
    ↓
تسجيل الدخول → (تاريخياً) /transport-preview | (backend حالياً) /service-preview
    ↓
GET /api/services/bookings — طلبات gas_delivery ضمن النطاق
    ↓
POST /api/services/bookings/:id/reserve — حجز
    ↓
POST /api/services/bookings/:id/location — GPS (accepted/delivering)
    ↓
POST /api/services/bookings/:id/complete — إتمام (provider → delivering → delivered)
    ↓
إيداع ledger + إشعار service.payment.settled
```

### 2.2 أين يظهر الطلب؟

| الواجهة | API | فلترة |
|---------|-----|-------|
| **Legacy:** `/services-provider.html` | `GET /api/services/bookings` | `filterBookingsForProvider` + نطاق غاز |
| **Portal 2.0 Transport** (تاريخي) | نفس API | chip «غاز» في `transport-preview.js` |
| **Portal 2.0 Service** (G1-R) | نفس API | `filterOrdersForPortal(..., "service")` |

```751:786:apps/services/routes.js
router.post("/bookings/:id/reserve", requireAuth, requireServiceProviderRole(), async (req, res) => {
    ...
    if (String(booking.service_type || "").toLowerCase() === "gas_delivery") {
      if (!providerWithinGasRadius(profile, booking, currentGasRadiusKm(booking))) {
        return fail(res, `الطلب خارج نطاق التوصيل الحالي (${currentGasRadiusKm(booking)} كم ...)`, 403);
      }
    }
```

**مزودو الغاز في DB:**

```10:11:shared/utils/serviceProviderTypes.js
  { value: "gas_cylinder_swap", label: "تبديل غاز اسطوانات", ... },
  { value: "gas_central_refill", label: "تعبئة غاز مركزي", ... },
```

```22:23:shared/utils/serviceProviderTypes.js
  if (t === "gas_cylinder_swap" || t === "gas_central_refill") {
    return ["gas_delivery"];
```

### 2.3 قبول الطلب (حجز)

1. المزود يضغط «حجز الطلب» في `services-provider.html` أو portal preview.
2. `POST /api/services/bookings/:id/reserve`
3. شروط: `delivery_status ∈ {new, pending}` · `provider_id IS NULL` · تطابق `service_type`/`gas_mode` · داخل نطاق 15/20 كم.
4. النتيجة: `accepted` + `provider_id` + `reserved_at`.

```804:815:apps/services/routes.js
    const reservePatch = applyProviderIdToPatch(
      {
        reserved_at: now,
        ...
        ...buildOrderStatusPatch(DELIVERY_STATUS.ACCEPTED),
      },
      uid
    );
```

**بعد الحجز:**
- واتساب ترحيب للمزود: `sendReserveWelcomeWhatsApp`
- واتساب للعميل: `sendOrderAcceptedToCustomer`

### 2.4 بدء التنفيذ

- **لا** حالة `picked_up` للغاز (مسار متجر/مندوب).
- المزود يحدّث GPS: `POST /api/services/bookings/:id/location` (حالات `accepted`, `delivering`, `picked`).
- «بدء التنفيذ» عملياً = `POST .../complete` بـ `actor=provider` → `delivering`.

### 2.5 التسليم والإغلاق

```878:922:apps/services/routes.js
router.post("/bookings/:id/complete", requireAuth, async (req, res) => {
    ...
    const done = await completeServiceBooking(sb, req.params.id, providerId, { actor });
    ...
    if (done.finalized) {
      await sendCustomerRateWhatsApp(view);
```

**`completeServiceOrder` — منطق الإغلاق:**

```92:114:shared/services/completeServiceOrder.js
  if (bothDone || actor === "legacy") {
    Object.assign(patch, buildOrderStatusPatch(DELIVERY_STATUS.DELIVERED));
    ...
  } else if (providerDone) {
    Object.assign(patch, buildOrderStatusPatch(DELIVERY_STATUS.DELIVERING));
  }
  ...
  if (finalized) {
    void settleCompletedServiceLedgerOnly(sb, id, "service:completed");
    providerCreditRow = await creditProviderOnDelivered(sb, data, "service:delivered");
  }
```

**اختصار legacy في واتساب المزود:**

```39:74:shared/services/gasDeliveryNotify.js
  const completeUrl = `${base}/api/driver/complete-order/${idEnc}`;
  ...
    `⬇️ إتمام المهمة:\n${completeUrl}\n\n` +
    `أو من لوحة المزود:\n${base}/services-provider.html`
```

### 2.6 توسيع نطاق البحث

Worker `startGasRadiusExpandWorker()` — كل 60 ثانية:

```15:51:apps/delivery/gasRadiusExpand.js
async function expandGasRadiusForOrder(sb, order) {
  ...
  const nextData = { ...data, gas_radius_km: GAS_RADIUS_EXPANDED_KM, gas_radius_expanded: true, ... };
  ...
  await notifyGasDeliveryProviders(sb, enriched, { radiusKm: GAS_RADIUS_EXPANDED_KM, ... });
```

- **ابتدائي:** 15 كم (`GAS_RADIUS_INITIAL_KM`)
- **بعد التوسيع:** 20 كم — تأخير افتراضي 5 دقائق (`ERVENOW_GAS_RADIUS_EXPAND_MINUTES`)

---

## 3. Workflow Classification — تصنيف الدورة

### 3.1 الحكم: **Service Workflow** (محرك تشغيلي)

| الدليل | الملف |
|--------|-------|
| حجز/إتمام عبر `/api/services/bookings/*` | `apps/services/routes.js` |
| `completeServiceOrder()` لـ `order_type ∈ {service, gas_delivery}` | `shared/services/completeServiceOrder.js` |
| `provider_id` (لا `driver_id`) كمالك المهمة | `apps/services/routes.js` reserve |
| إشعار مزودين `role=service` | `shared/services/gasDeliveryNotify.js` |

### 3.2 **ليس** Driver Workflow

```6:38:shared/utils/driverDispatchOrders.js
const DRIVER_EXCLUDED_ORDER_TYPES = new Set(["service", "gas_delivery"]);
...
const DRIVER_EXCLUDED_SERVICE_TYPES = new Set([
  ...
  "gas_cylinder_swap",
  "gas_central_refill",
  "gas_delivery",
  ...
]);
function isDriverDispatchOrder(order) {
  ...
  if (DRIVER_EXCLUDED_ORDER_TYPES.has(ot)) return false;
  if (st && DRIVER_EXCLUDED_SERVICE_TYPES.has(st)) return false;
```

- لا يدخل طابور `deliveryQueue` للمندوبين.
- لا يظهر في `GET /api/driver/orders` dispatch list.
- `internal_delivery` فقط هو توصيل داخلي للمندوب.

### 3.3 **Hybrid artifacts** (طبقة UI/اختصارات — ليست محركاً مستقلاً)

| Artifact | الوصف |
|----------|-------|
| Transport Portal UI | chip «غاز» في `transport-preview.js` — `docs/PORTAL-AUDIT-REPORT.md` §4.4 |
| `portal_type=transport` (تاريخي) | قبل migration G1-R |
| `/api/driver/complete-order/:id` في واتساب الغاز | اختصار إغلاق — يمر عبر `completeServiceOrder` |
| `createGasDelivery` → `createDeliveryOrderFromBody` | legacy create path — لا يغيّر workflow الإتمام |

**الخلاصة:** التصنيف الصحيح = **Service Workflow** مع **تشابك UI/routing تاريخي** (Transport) وليس workflow مستقل ثالث.

---

## 4. Routing Audit — التوجيه والأدوار

### 4.1 العميل

| الحقل | القيمة |
|-------|--------|
| `role` | `customer` |
| `portal_type` (طلب) | `service` (بعد G1-R) · كان `transport` (قبل migration) |
| بوابة العضو | `/start-now.html` |

### 4.2 مزود الغاز

| الحقل | القيمة الفعلية في DB |
|-------|----------------------|
| `role` | **`service`** (دائماً) |
| `service_type` | **`gas_cylinder_swap`** أو **`gas_central_refill`** |
| `portal_type` للطلب | **`service`** (backend حالي) |

**Backend — بعد G1-R (commit 93947de area):**

```16:25:shared/utils/resolvePortalRole.js
const SERVICE_PORTAL_TYPES = new Set([
  ...
  "gas_cylinder_swap",
  "gas_central_refill",
  "gas_delivery",
]);
```

**Backend — قبل G1-R (commit 3ad1917):**

```
TRANSPORT_PORTAL_TYPES = { ..., gas_cylinder_swap, gas_central_refill, gas_delivery }
SERVICE_PORTAL_TYPES   = { electrician, plumber, ac_technician, laundry_estates, agricultural_engineer }
```

**Migration backfill:**

```29:44:shared/migration_orders_portal_type.sql
  WHEN o.order_type IN ('service', 'gas_delivery') THEN
    CASE WHEN o.service_type IN (..., 'gas_cylinder_swap', 'gas_central_refill', 'gas_delivery') ... THEN 'service'
...
   OR o.portal_type = 'transport' AND o.service_type IN ('internal_delivery', 'gas_cylinder_swap', 'gas_central_refill', 'gas_delivery')
   OR o.portal_type = 'transport' AND o.order_type = 'gas_delivery';
```

### 4.3 تناقض Frontend (لم يُحدَّث بالكامل)

`account-destinations.js` و `role-routing.js` ما زالا يضعان `gas_*` في `TRANSPORT_SERVICE_TYPES` → توجيه `/transport-preview`:

```17:26:ervenow-frontend/assets/account-destinations.js
  var TRANSPORT_SERVICE_TYPES = {
    ...
    gas_cylinder_swap: 1,
    gas_central_refill: 1,
    gas_delivery: 1,
  };
```

```71:79:ervenow-frontend/assets/account-destinations.js
    if (r === "service" && serviceType) {
      var st = String(serviceType).trim().toLowerCase();
      if (TRANSPORT_SERVICE_TYPES[st]) {
        var transport = ROLE_HOME.transport;
        return { role: "transport", path: canonicalPath(transport.path, "transport"), ... };
```

**النتيجة التاريخية الفعلية:** مزود الغاز يسجّل كـ `role=service` لكن **يُوجَّه لواجهة Transport** — بينما APIs والإتمام Service.

---

## 5. Settlement Audit — المحاسبة

### 5.1 عند `delivered`

1. `settleCompletedServiceLedgerOnly()` — `ervenow_ledger_settle_*` (shadow ledger)
2. `creditProviderOnDelivered()` — RPC `ervenow_ledger_credit`

```111:114:shared/services/completeServiceOrder.js
  if (finalized) {
    void settleCompletedServiceLedgerOnly(sb, id, "service:completed");
    providerCreditRow = await creditProviderOnDelivered(sb, data, "service:delivered");
  }
```

### 5.2 مبلغ الإيداع

```19:38:shared/services/providerLedgerCredit.js
async function creditProviderOnDelivered(sb, order, context = "delivered") {
  ...
  const amount = orderTotalAmount(order);  // total_amount من orders
  ...
  await sb.rpc("ervenow_ledger_credit", { p_user_id: providerId, p_amount: amount, p_reference: orderId });
```

| البند | القيمة |
|-------|--------|
| **المُ credited في RPC** | `orders.total_amount` (كامل مبلغ الطلب) |
| **`data.provider_net`** | 37 ر.س/أسطوانة — **مُخزَّن للمرجعية** عند الإنشاء، **لا يُستخدم** في `creditProviderOnDelivered` |
| **عمولة المنصة (أسطوانة)** | 2 ر.س/أسطوانة في `platform_commission` |
| **عمولة المنصة (مركزي)** | `computePlatformCommission(total)` — نسبة |

**ملاحظة تدقيق:** رسائل واتساب للمزود تذكر «عمولة 7% في ذمتكم» (`serviceBookingNotify.js`) — قد لا تطابق آلية ledger الفعلية لأسطوانات الغاز (2 ر.س ثابت).

### 5.3 إشعار التسوية

```319:347:shared/services/unifiedOrderStatus.js
  if (ds === DELIVERY_STATUS.DELIVERED) {
    ...
    const portal = resolveOrderPortalType(order);
    const ev = portal === "transport" ? "transport.payment.settled" : "service.payment.settled";
    await notifyProviderForOrder(sb, order, providerId, ev, "تمت تسوية مالية", ...);
```

- طلبات غاز **بعد G1-R:** `service.payment.settled`
- طلبات غاز **تاريخية** (`portal_type=transport`): `transport.payment.settled`

### 5.4 السحب

| API | الأدوار |
|-----|---------|
| `GET/POST /api/wallet/withdraw` | `PAYOUT_ROLES = ["driver", "store", "restaurant", "merchant", "service"]` |
| `POST /api/wallet/withdraw/send-otp` | نفس الأدوار |
| `POST /api/wallet/withdraw/confirm-otp` | نفس الأدوار |

**واجهة:** `portal-wallet-withdraw.js` في بوابات المزود (Service/Transport).

**جدول الطلبات:** `ervenow_withdraw_requests` — موافقة admin.

---

## 6. Notification Audit — الإشعارات

### 6.1 للعميل

| الحدث | القناة | المُحفِّز |
|-------|--------|----------|
| `customer.order.received` | in-app | تعريف في `notificationEvents.js` — **لا يُستدعى تلقائياً** لمسار الغاز عند الإنشاء |
| واتساب «تم الدفع» | WhatsApp | `sendCustomerOrderPaidWhatsApp` — إذا `payment_status=paid` |
| واتساب «تم قبول الطلب» | WhatsApp | `sendOrderAcceptedToCustomer` — عند reserve |
| `customer.order.delivered` | in-app | `unifiedOrderStatus` — مسار driver workflow (picked_up/delivering/delivered) — **قد لا يُطلَق** لمسار service-only بدون انتقالات driver |
| واتساب تقييم | WhatsApp | `sendCustomerRateWhatsApp` — عند finalized complete |
| `/track?id=...` | صفحة عامة | `deliveryCustomerWhatsApp.buildPublicTrackUrl` |

### 6.2 لمزود الغاز

| الحدث | القناة | المُحفِّز |
|-------|--------|----------|
| `service.request.new` أو `transport.request.new` | in-app | `notifyProvidersInAppByPhones` → `notifyProvidersForNewBooking` — **يعتمد `portal_type`** |
| واتساب طلب جديد | WhatsApp | `notifyGasDeliveryProviders` — إذا `ERVENOW_SERVICE_WA_ON_CREATE=1` |
| واتساب (legacy gas-order) | WhatsApp | `sendGasProviderWhatsApp` → `notifyGasDeliveryProviders` — **دائماً** بعد `createGasDelivery` |
| إشعار توسيع نطاق | in-app + WA | `gasRadiusExpand.js` |
| `service.payment.settled` / `transport.payment.settled` | in-app | عند `delivered` + نجاح ledger credit |
| واتساب حجز | WhatsApp | `sendReserveWelcomeWhatsApp` — للمزود بعد reserve |

**محتوى واتساب المزود (غاز):**

```62:74:shared/services/gasDeliveryNotify.js
  return (
    `🚚 ERVENOW\n\n` +
    `طلب غاز جديد:\n\n` +
    ...
    `⬇️ إتمام المهمة:\n${completeUrl}\n\n` +
    `أو من لوحة المزود:\n${base}/services-provider.html`
  );
```

**Cascade routing:**

```145:149:shared/services/homeServiceNotify.js
async function notifyHomeServiceProvidersCascade(sb, booking) {
  ...
  if (serviceType === "gas_delivery") {
    return notifyGasDeliveryProviders(sb, booking);
  }
```

---

## 7. Final Recommendation — التوصية الهندسية

### ✅ **الخيار A — Gas → Service Portal**

### السبب (من الأدلة، ليس من افتراض):

1. **المحرك التشغيلي Service بالكامل:** reserve · complete · `provider_id` · `completeServiceOrder` · `/api/services/*` — لا يوجد مسار dispatch للمندوب.
2. **استبعاد صريح من Driver:** `driverDispatchOrders.js` يستبعد `gas_delivery` وجميع `gas_*`.
3. **حساب المزود:** `role=service` + `gas_cylinder_swap|gas_central_refill` — نفس نموذج مزود الخدمات المنزلية.
4. **G1-R Backend متسق:** `resolvePortalRole` و `migration_orders_portal_type.sql` نقلوا الغاز إلى `service`.
5. **Transport كان طبقة UI/routing تاريخية:** chip «غاز» في Transport + `portal_type=transport` كانا **تصنيفاً خاطئاً** يسبب تسرباً (`PORTAL-AUDIT-REPORT.md` §4.4) — وليس workflow مختلفاً.

### لماذا ليس B (Driver Portal)؟

- لا queue مندوب · لا `driver_id` · لا picked_up/delivering عبر driver APIs · مستبعد من `isDriverDispatchOrder`.

### لماذا ليس C (Hybrid) كبوابة نهائية؟

- **Hybrid كان واقعاً legacy** (Service engine + Transport UI + رابط driver complete في WA) — هذا **ديون تقنية** وليس تصميماً مقصوداً.
- اعتماد Hybrid كتصنيف نهائي ي perpetuate التناقض بين backend (`service`) و frontend mirrors (`transport-preview`).

### إجراءات ما بعد التقرير (خارج نطاق «تغيير التصنيف»):

| # | إجراء | الأولوية |
|---|-------|----------|
| 1 | مزامنة `role-routing.js` · `account-destinations.js` · `transport-preview.js` مع backend (إزالة gas من Transport UI) | عالية |
| 2 | إنشاء حساب `role=service` + `gas_cylinder_swap` للتحقق live E2E | عالية |
| 3 | مراجعة `creditProviderOnDelivered` vs `data.provider_net` لأسطوانات الغاز | متوسطة |
| 4 | توحيد رسائل WA (7% vs 2 ر.س/أسطوانة) | منخفضة |

---

## 8. ملحق — مسارات الإنشاء المزدوجة

| | Checkout (`createServiceOrder`) | Legacy (`createGasDelivery`) |
|---|--------------------------------|------------------------------|
| Entry | `/gas-delivery` → checkout | `POST /api/services/gas-order` |
| `delivery_status` | `new` | `pending` |
| Notify on create | `notifyProvidersForBooking` | `sendGasProviderWhatsApp` |
| `order_type` | `gas_delivery` | `gas_delivery` |
| Portal apply | `applyPortalTypeToOrderRow` | عبر delivery insert |

**كلا المسارين** يلتقيان عند: `GET /api/services/bookings` → reserve → complete → settlement.

---

## 9. ملحق — ملفات مرجعية

| المجال | الملفات |
|--------|---------|
| عميل UI | `ervenow-frontend/gas-delivery.html` |
| إنشاء | `shared/services/serviceOrderCreate.js`, `apps/delivery/gasDeliveryCreate.js`, `apps/checkout/service.js` |
| مزود API | `apps/services/routes.js` |
| مزود UI legacy | `public/services-provider.html` |
| إشعارات | `shared/services/gasDeliveryNotify.js`, `shared/services/homeServiceNotify.js`, `shared/services/serviceBookingNotify.js` |
| إتمام/تسوية | `shared/services/completeServiceOrder.js`, `shared/services/providerLedgerCredit.js` |
| استبعاد مندوب | `shared/utils/driverDispatchOrders.js` |
| توجيه | `shared/utils/resolvePortalRole.js`, `shared/utils/orderPortalRouting.js` |
| تسعير | `shared/utils/gasDeliveryPricing.js`, `shared/utils/gasDeliveryRadius.js` |
| توسيع نطاق | `apps/delivery/gasRadiusExpand.js` |
| تدقيق بوابات | `docs/PORTAL-AUDIT-REPORT.md` |

---

**نهاية التقرير.**  
**الحكم:** دورة الغاز Legacy = **Service Workflow** · التصنيف التاريخي للبوابة = **Transport (UI/routing)** · **التوصية = الخيار A (Service Portal).**
