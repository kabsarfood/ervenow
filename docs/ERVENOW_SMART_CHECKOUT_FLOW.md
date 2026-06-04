# ERVENOW SMART CHECKOUT & DELIVERY ENGINE 1.0

**نوع المستند:** خطة منتج + تحليل + تنفيذ مقترح (محدّث)  
**يحل محل:** أقسام «التوصيل داخل السلة» في مسودة SMART CHECKOUT السابقة — **ملغاة**  
**النطاق:** سياسة التوصيل، ما قبل السلة، بيانات السطر، السلة (مراجعة + دفع)، الطلب — **بدون** تعديل Ledger / Revenue Flow / Financial Hardening  
**التاريخ:** 2026-06-03

---

## 0. القرار المنتجّي المعتمد

```text
السلة = مراجعة + دفع فقط
```

```text
التوصيل + الموقع + الاستلام = قبل إضافة المنتج للسلة (Pre-Cart Gate)
```

أي accordion «موقع / نوع توصيل» داخل الدرج أو `/cart` **لن يُبنى** في 1.0؛ يُستبدل بـ **Delivery Policy Engine** + **نافذة ما قبل السلة** على صفحة المتجر (ومصادر إضافة منتجات لاحقاً).

---

## 1. التدفق: قديم vs جديد

### 1.1 الوضع القديم (مرفوض للتنفيذ)

```text
منتجات → سلة → موقع → توصيل → دفع
```

### 1.2 الوضع الجديد (المعتمد)

```text
منتجات
  ↓
اختيار طريقة الاستلام (حسب سياسة المتجر)
  ↓
(إذا توصيل: Store أو ERVENOW)
  ↓
  تحديد الموقع | لصق رابط Google Maps | GPS
  ↓
  احتساب: مسافة + ETA + رسوم (أو مجاني)
  ↓
إضافة للسلة (مع snapshot كامل في item.data)
  ↓
السلة (UX 2.0: منتجات + ملخص + دفع)
  ↓
الدفع → POST /api/order/create
```

### 1.3 ما يبقى من البنية الحالية

| موجود اليوم | دوره في 1.0 |
|-------------|-------------|
| `addToCart` / متجر واحد | يُوسَّع `item.data` بحقول التوصيل؛ لا تغيير قاعدة «متجر واحد» |
| `computeErvCartBreakdown` | يقرأ `delivery_fee` من السلة (مجموع/سطر) بدل `__ervCartDeliveryFee` العام |
| `runCheckoutInsert` | يتحقق من `item.data` + يعيد حساب quote للتطابق |
| `ervenow_ledger_checkout_ew_pay` | كما هو |
| `checkout-dispatch` | فقط لـ **ERVENOW Delivery** |
| `delivery-map-page.js` parser | يُعاد استخدامه في Pre-Cart Gate |
| UX 2.0 accordion | **منتجات · ملخص · دفع** فقط |

---

## 2. مبدأ السلة (Cart 1.0)

### 2.1 داخل السلة يظهر

- قائمة المنتجات مع **ملخص التوصيل المسبق** (قراءة فقط).
- ملخص المبالغ (فرعي، توصيل، ضريبة، إجمالي).
- وسيلة الدفع + إتمام الطلب.

### 2.2 داخل السلة لا يظهر

- ❌ تحديد موقع جديد  
- ❌ تغيير نوع التوصيل (إلا بإعادة الشراء من المتجر — مرحلة لاحقة)  
- ❌ إعادة حساب مسافة من الصفر  

### 2.3 إزالة تدريجية

- `#storeDeliveryCard` في `/cart` → **مهمل** بعد Pre-Cart؛ يُحذف من UI عند اكتمال الموجة A.
- `pendingGeo` + `refreshCartDeliveryFee()` → يُستبدل بقراءة بيانات السطر.

---

## 3. Delivery Policy Engine (لوحة المتجر)

قسم جديد في `store-dashboard.html`:

```text
سياسة التوصيل
```

### 3.1 طرق الاستلام (`fulfillment_mode`)

| القيمة | العرض | سلوك |
|--------|-------|------|
| `pickup_only` | استلام من المتجر فقط | لا توصيل؛ لا مندوب؛ `delivery_fee = 0` |
| `store_delivery` | توصيل ذاتي (المتجر) | موقع إلزامي قبل السلة؛ طلب للمتجر؛ **لا** `checkout-dispatch` |
| `ervenow_delivery` | توصيل ERVENOW | موقع + quote؛ `checkout-dispatch` |
| `store_and_ervenow` | الخياران | العميل يختار في Pre-Cart |

**مخطط DB مقترح (جدول `stores` أو `store_delivery_policy`):**

```sql
-- stores (أعمدة جديدة — migration منفصل)
fulfillment_mode text NOT NULL DEFAULT 'ervenow_delivery'
  CHECK (fulfillment_mode IN (
    'pickup_only', 'store_delivery', 'ervenow_delivery', 'store_and_ervenow'
  )),

fee_policy text NOT NULL DEFAULT 'distance_based'
  CHECK (fee_policy IN (
    'distance_based', 'free', 'free_above_minimum', 'free_within_km'
  )),

fee_per_km numeric,                    -- افتراضي 2.3 إن null
free_delivery_minimum_order numeric,   -- لـ free_above_minimum
free_delivery_within_km numeric,       -- لـ free_within_km
delivery_radius_km numeric             -- موجود؛ يبقى حد التغطية
```

**API:**

- `GET /api/store/public/:id` → يُرجع `delivery_policy` للعرض في المتجر.
- `PATCH /api/store/merchant-settings` (موجود أو جديد) → حفظ السياسة.

---

## 4. سياسات رسوم التوصيل (`fee_policy`)

يُطبَّق في **محرك التسعير** (خادم + عرض Pre-Cart) بعد المسافة وقيمة السلة.

| السياسة | المنطق |
|---------|--------|
| `distance_based` | `round(km × fee_per_km, 2)` — الافتراضي 2.3 |
| `free` | `delivery_fee = 0`، `delivery_free_reason = 'store_policy'` |
| `free_above_minimum` | إن `cart_subtotal_for_line ≥ minimum` → 0 وإلا distance_based |
| `free_within_km` | إن `km ≤ within_km` → 0 وإلا distance_based |

**عرض للعميل (متجر):**

- فوق الحد: `🎁 التوصيل مجاني للطلبات فوق 100 ر.س`
- داخل النطاق: `🎁 توصيل مجاني حتى 5 كم`

---

## 5. منتج «شامل التوصيل»

**على المنتج (اختياري):**

```sql
-- store_products أو products
includes_delivery boolean NOT NULL DEFAULT false
```

**عند `includes_delivery = true`:**

- رسوم التوصيل لهذا السطر = **0** (أو تُخصم من quote المجموع — قرار: **per-line override**).
- شارة في المتجر: `🚚 هذا المنتج يشمل التوصيل مجاناً`.
- في `item.data`: `delivery_included: true`.

**تعارض:** إن السلة تحتوي سطراً «شامل التوصيل» وسطراً عادياً → quote على مستوى **الطلب** مع توزيع أو أعلى رسوم سطر واحد — **مقترح 1.0:** رسوم توصيل **واحدة لكل snapshot جلسة إضافة**؛ عند دمج كميات نفس المنتج تُحدَّث من نفس الـ snapshot.

---

## 6. Pre-Cart Gate («أضف للسلة»)

### 6.1 نقطة الدخول

استبدال الاستدعاء المباشر في `store.html` → `addProductToCart(p, qty)` بـ:

```text
onAddToCartClick(p, qty)
  → fetch store delivery_policy
  → branch
```

### 6.2 فروع القرار

| سياسة المتجر | الإجراء |
|--------------|---------|
| `pickup_only` | `fulfillment: pickup` → `addToCart` مباشرة |
| توصيل (store / ervenow / both) | فتح modal **📍 تحديد موقعك** |
| `store_and_ervenow` | خطوة 1: اختيار الاستلام؛ خطوة 2: موقع إن لزم |

### 6.3 Modal المحتوى

- تبويب/أزرار: **خريطة** | **لصق رابط Google Maps** | **موقعي الحالي**
- إعادة استخدام: `deliveryMapOrder` / منطق `delivery-map-page.js`
- بعد الإحداثيات: `GET /api/store/:id/delivery-quote?lat=&lng=&fulfillment=&subtotal=&product_includes_delivery=`

**استجابة quote:**

```json
{
  "ok": true,
  "distance_km": 5.2,
  "eta_minutes": 14,
  "delivery_fee": 12.0,
  "delivery_free": false,
  "free_delivery_message": null,
  "within_radius": true,
  "fulfillment": "ervenow_delivery"
}
```

### 6.4 تأكيد الإضافة

زر «إضافة للسلة» في الـ modal يبني:

```javascript
ErvenowCart.add({
  type: storeMeta.type,
  title: "...",
  price: unit * qty,
  data: {
    store_id, product_id, qty, unit_price,
    fulfillment_mode: "ervenow_delivery" | "store_delivery" | "pickup",
    drop_lat, drop_lng,
    drop_address, drop_maps_url,
    distance_km, eta_minutes,
    delivery_fee, delivery_free, delivery_free_reason,
    delivery_included: false,
    delivery_quote_id: "uuid-or-hash",  // اختياري للتدقيق
    store_name
  }
});
```

**قاعدة توافق المتجر:** إن السلة فيها `store_id` آخر → رسالة موجودة؛ إن نفس المتجر لكن **fulfillment/موقع مختلف** → **1.0:** منع الإضافة أو استبدال snapshot الجلسة (قرار منتج: **منع** مع «أفرغ السلة أو أكمل بنفس نوع التوصيل»).

---

## 7. عرض السلة (بيانات جاهزة)

### 7.1 على سطر المنتج (`renderCartLineHtml`)

مثال العرض:

```text
🍗 كبسة لحم
🚚 توصيل بواسطة ERVENOW
📍 حي النرجس
📏 5.2 كم · ⏱️ 14 دقيقة
💰 رسوم التوصيل: 12 ر.س
```

أو عند مجاني:

```text
🎁 التوصيل مجاني
```

**Pickup:**

```text
🏪 استلام من المتجر
```

### 7.2 ملخص المبالغ

- `delivery_fee` = مجموع رسوم السطور **أو** رسوم snapshot واحدة إن كل السطور تشترك نفس quote (متجر واحد + نفس الموقع).
- **1.0:** طلب متجر واحد → عادة **quote واحد** يُنسخ لكل سطر جديد بنفس الجلسة؛ زيادة كمية سطر موجود = لا إعادة quote.

### 7.3 `computeErvCartBreakdown` (تعديل مقترح)

```javascript
function resolveCartDeliveryFeeFromItems(cart) {
  // pickup_only lines → 0 for those lines
  // max(delivery_fee) or sum per unique quote_id — document in code
}
```

إزالة الاعتماد على `window.__ervCartDeliveryFee` كمصدر وحيد.

---

## 8. الطلب النهائي (للمطعم والمنصة)

### 8.1 حقول `orders` (موجود + إضافات في `breakdown`)

| حقل | مصدر |
|-----|------|
| `order_total` | مجموع منتجات |
| `delivery_fee` | من السلة / إعادة quote خادم |
| `distance_km`, `drop_lat`, `drop_lng`, `drop_address` | من السلة |
| `payment_method`, `payment_status` | من checkout |
| **جديد في breakdown** | `fulfillment_mode`, `eta_minutes`, `delivery_free`, `delivery_included` |

### 8.2 `runCheckoutInsert` (تعديلات مسموحة — لا Ledger)

- قراءة `fulfillment` من `groupItems[0].data`.
- `pickup_only`: لا `drop_lat` إلزامي؛ `delivery_fee = 0`؛ لا dispatch.
- `store_delivery`: إحداثيات إلزامية؛ **لا** `enqueueDeliveryJob`.
- `ervenow_delivery`: كما اليوم + dispatch.
- إعادة quote للتحقق من التلاعب (`financial_intent` + quote server).

### 8.3 إشعار المتجر

توسيع `runStoreCheckoutSideEffects` / `createNotification.payload`:

```text
نوع التوصيل · العنوان/الإحداثيات · كم · ETA · رسوم · مدفوع/غير مدفوع
```

---

## 9. التوصيل الذاتي (Store Delivery) + OTP

**بدون تعديل Ledger RPCs** — استخدام `delivery_status` الموجود ومسار التسوية عند `delivered` كما هو.

### 9.1 تدفق مقترح

```text
المتجر يستلم الطلب
  ↓
المتجر: «في الطريق» (اختياري)
  ↓
المتجر: «تم التسليم» → يولّد OTP للعميل (SMS/واتساب)
  ↓
العميل يُدخل OTP (صفحة تتبع / رابط طلب)
  ↓
delivery_status = delivered
  ↓
Settlement الحالي (deliveredFinancialSettlement / ledger_only — كما مُفعّل)
```

### 9.2 مكونات جديدة (طبقة تطبيق)

| مكوّن | وصف |
|--------|------|
| `POST /api/store/orders/:id/request-delivery-otp` | متجر — يولّد رمز مؤقت |
| `POST /api/order/:id/confirm-receipt` | عميل — يتحقق من OTP |
| جدول `order_receipt_otps` | `order_id`, `code_hash`, `expires_at` — لا Ledger |

**فصل عن ERVENOW Delivery:** لا `driver_id`؛ لا `checkout-dispatch`.

---

## 10. ERVENOW PAY (بدون تغيير Ledger)

- Pre-Cart **لا يخصم** — الخصم عند `POST /api/order/create` فقط.
- `validateEwPayCheckout` في السلة قبل الإرسال.
- إرجاع `ledger_reference` في HTTP response للعرض (wrap فقط).

---

## 11. خطة التنفيذ (موجات)

### موجة 0 — توثيق + قرارات (هذا المستند) ✅

- إلغاء بناء التوصيل داخل السلة.
- تثبيت مخطط `item.data`.

### موجة 1 — Policy Engine + Quote API (أسبوع 1–2)

| # | مهمة |
|---|------|
| 1.1 | Migration سياسة المتجر |
| 1.2 | UI «سياسة التوصيل» في لوحة المتجر |
| 1.3 | `GET delivery-quote` + `computeDeliveryFee(policy, km, subtotal)` |
| 1.4 | توسيع `GET /api/store/public/:id` |
| 1.5 | اختبارات وحدة للسياسات الأربع |

### موجة 2 — Pre-Cart Gate (أسبوع 2–3)

| # | مهمة |
|---|------|
| 2.1 | `pre-cart-delivery-modal.js` + CSS متجاوب |
| 2.2 | ربط `store.html` (وبعدين browse/catalog) |
| 2.3 | `includes_delivery` على المنتج + شارة |
| 2.4 | توسيع `addToCart` / دمج كمية مع الحفاظ على snapshot |

### موجة 3 — السلة والدفع (أسبوع 3–4)

| # | مهمة |
|---|------|
| 3.1 | `renderCartLineHtml` — عرض snapshot |
| 3.2 | `computeErvCartBreakdown` من السطر |
| 3.3 | إزالة `#storeDeliveryCard` من `/cart` |
| 3.4 | `runCheckoutInsert` — فروع fulfillment |
| 3.5 | إشعار متجر غني |

### موجة 4 — Store Delivery OTP (أسبوع 4–5)

| # | مهمة |
|---|------|
| 4.1 | OTP tables + APIs |
| 4.2 | لوحة متجر: تأكيد تسليم |
| 4.3 | واجهة عميل تأكيد الاستلام |
| 4.4 | اختبار: delivered → settlement موجود **بدون** تغيير RPC |

---

## 12. ممنوعات (ثابتة)

- ❌ تعديل `ervenow_ledger_*` definitions أو منطق الخصم/التسوية  
- ❌ Financial Hardening migrations  
- ❌ تغيير Revenue Flow / عمولة المنصة  
- ❌ بوابات دفع جديدة  
- ❌ موقع/توصيل داخل accordion السلة في 1.0  

---

## 13. مخاطر وقرارات مفتوحة

| # | سؤال | توصية 1.0 |
|---|------|-----------|
| 1 | سطران بموقعين مختلفين لنفس المتجر؟ | منع الإضافة الثانية |
| 2 | تعديل كمية بعد تغيير سياسة المتجر؟ | quote يُجمّد في السطر |
| 3 | `includes_delivery` + `free_above_minimum` معاً؟ | أولوية: `includes_delivery` على السطر |
| 4 | استلام من المتجر + منتج في نفس السلة؟ | غير مسموح إن `fulfillment_mode` ليس pickup_only لجلسة الإضافة |

---

## 14. مراجع كود

| الموضوع | مسار |
|---------|------|
| إضافة منتج اليوم | `public/store.html` → `addProductToCart` |
| سلة | `public/assets/cart.js`, `cart-ui.js` |
| Checkout | `apps/checkout/service.js`, `apps/order/cartCheckoutHttp.js` |
| EW PAY | `shared/services/ervenowPayCheckout.js` |
| Maps parser | `shared/utils/deliveryMapOrder.js`, `delivery-map-page.js` |
| مسافة | `shared/utils/routeDistance.js` |
| تسوية عند التسليم | `shared/services/deliveredFinancialSettlement.js` (قراءة فقط — لا تعديل) |
| UX 2.0 | `public/assets/cart-luxe.css` |

---

## 15. ملخص للمطور

1. **ابنِ Policy Engine + Quote في الخادم أولاً.**  
2. **Pre-Cart Gate على المتجر** قبل لمس السلة.  
3. **السلة تعرض وتدفع** فقط — تقرأ `item.data`.  
4. **Checkout يتحقق** ويفرّع dispatch حسب `fulfillment`.  
5. **Store Delivery OTP** طبقة منفصلة فوق `delivery_status` دون Ledger.

---

*نسخة المستند: **DELIVERY ENGINE 1.0** — متوافقة مع قرار «التوصيل قبل السلة».*
