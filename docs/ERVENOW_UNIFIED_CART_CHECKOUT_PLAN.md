# ERVENOW — Unified Cart / Checkout / Fulfillment Groups

**التاريخ:** 2026-09-22  
**النوع:** خطة قبل التنفيذ — لم يُغيَّر كود السلة أو Checkout أو الطلبات أو الدفع أو Ledger.

المبدأ المعتمد: أي اختيار من أي قسم يمر بسلة واحدة ثم Checkout واحد. المحركات التنفيذية (Store / Service / Transport / Delivery) تبقى كما هي. لا Order هجينة.

---

## 1. كيف تعمل السلة الحالية؟

مساران ما زالا موجودين في الكود:

**أ) المسار الرسمي (بعد Checkout Engine):**  
الصفحات تضيف عبر `ErvenowOrderDraftVertical.commit(...)` إلى **Order Draft**.  
ثم `/checkout` يعرض المسودة ويؤكّد.

هذا ما تستخدمه اليوم:

* `store.html` (مطعم/متجر/صيدلية…)
* `service-book.html`
* `gas-delivery.html`
* `delivery-services.html` (غاز / محلي / سطحة / أثاث)
* `car-polishing.html`
* خريطة التوصيل
* `browse.html`

**ب) المسار القديم:**  
`cart.js` + `addToCart` + `localStorage.cart`.  
ما زال حيًّا في `cart.html` ودوال `executeCartCheckout`.  
`GET /cart` يحوّل 302 إلى `/checkout`.

قاعدة الواجهة الحالية: **لا خلط منتجات متجرين** (تنبيه ويرفض الإضافة).  
خلط منتج متجر + خدمة بلا `store_id` **مسموح** في المسودة.

عند إضافة خدمة/توصيل تُطلب غالبًا بيانات (جوال، مواقع، سعر) **قبل** الدخول للسلة — بخلاف منتجات المتجر.

---

## 2. أين تُخزَّن؟

| الطبقة | المفتاح | أين |
|---|---|---|
| المسودة الرسمية | `ervenow:order-draft` | **localStorage** فقط |
| السلة القديمة | `cart` | localStorage |
| موقع التوصيل القديم | `ervenow:delivery-location` | localStorage |
| وسيلة الدفع القديمة | `erv_cart_payment_method` | localStorage |
| مفتاح منع التكرار | `ervenow:checkout-idem` | sessionStorage |

لا يوجد جدول Backend للسلة. الخادم لا يرى العناصر حتى زر التأكيد.

---

## 3. LocalStorage أم Backend Draft؟

**LocalStorage (المسودة) حتى التأكيد.**  
بعد `POST /api/order/create` تُكتب صفوف `orders` فورًا.

إن فُعّل بوابة الدفع، قد يُدرج الصف بـ `delivery_status=draft` حتى الدفع، ثم يُنشر.  
هذا **ليس** سلة؛ هو سجل طلب مبكر.

---

## 4. هل تحمل Service وليس Product فقط؟

نعم. عنصر المسودة حرّ الشكل تقريبًا:

```
{ id, type, title, price, customer_phone?, payment_status?, data: { ... } }
```

`type` الحالي يشمل مثلًا:

* أنواع متجر (`restaurant`, `supermarket`, `pharmacy`…) + `product_id` / `store_id`
* خدمات (`plumber`, `electrician`, `gas_delivery`, `car_polishing`…)
* نقل (`pickup_truck`, `furniture_move`, `car_transport`…)
* توصيل خريطة (`delivery` + إحداثيات)

المسودة لها حقل واحد `service_type` وحقل واحد `provider_id` يُستنتجان من العناصر. هذا **لا يكفي** لسلة مختلطة؛ يجب أن يبقى وصفيًا فقط، والتقسيم من `items`.

---

## 5. كيف ينشئ Checkout الطلب الحالي؟

صفحة `/checkout` (`checkout-engine.js`):

1. تقرأ Order Draft (وتُهاجر من `cart` إن كانت المسودة فارغة).
2. تعرض بنودًا + عنوان + دفع + «تأكيد الطلب».
3. إن لم يوجد توكن → `/login?mode=register&role=customer&next=/checkout` (يخلط مسار الشراء بإنشاء العضوية).
4. `POST /api/order/create` مع `{ items, payment_method, customer_lat/lng, financial_intent }`.

الخادم (`runCheckoutInsert`):

* يعيد تسعير منتجات المتجر من الكتالوج.
* يقسم العناصر إلى 4 دلاء: `restaurant` / `store` / `service` / `delivery`.
* يُدرج صفوف `orders` ويستدعي المحرك المناسب (متجر، خدمة، توصيل موحّد).
* لمتجر: إشعار التاجر + طابور المندوب إن كان `pending`.
* `ew_pay`: خصم المحفظة بعد الإدراج (Ledger موجود — **لا نلمسه في هذه الخطة**).

`POST /api/checkout` مهمل ويصل لنفس المنطق.

مسار API بلا `items` ما زال ينشئ خدمة أو توصيلًا مباشرة — الواجهة العامة لا تستخدمه بعد التحويل إلى المسودة.

---

## 6. متى يُكتب سجل `orders`؟

عند نجاح `POST /api/order/create` (يتطلب جلسة `requireAuth`).

قبل ذلك: مسودة محلية فقط.  
بعد الإدراج: التاجر/المندوب/المزود قد يُبلَّغون فورًا إن كان `delivery_status=pending`.

القاعدة المطلوبة «لا جوال موثّق → لا طلب تنفيذي» **غير مكتملة**: التأكيد يحتاج توكن، لكن التوكن اليوم يفتح أيضًا مسار تسجيل العضوية، والإدراج يصل للجهات قبل عزل OTP الشراء.

---

## 7. هل توجد أكثر من Cart Engine؟

نعم، اثنتان:

1. **Order Draft** — المصدر المعتمد للإضافة والعرض في `/checkout`.
2. **cart.js / ErvenowCart** — قديم؛ `/cart` محوّل؛ `cart.html` ما زال ينفّذ checkout مستقلًا إن فُتح الملف مباشرة.

شارة الرأس في الرئيسية تقرأ المسودة لا `cart`.

---

## 8. هل توجد أكثر من Checkout؟

نعم، من حيث الكود:

| الواجهة | الحالة |
|---|---|
| `/checkout` + `checkout-engine.js` | الرسمي للعميل |
| `cart.html` + `executeCartCheckout` | قديم، المرور عبر `/cart` يُحوَّل |
| `POST /api/order/create` | الإنشاء الوحيد المعتمد |
| `POST /api/checkout` | مهمل |
| إنشاء خدمة/توصيل بلا سلة | باقٍ في الـ API |

تجربة العميل المستهدفة: **`/checkout` فقط.**

---

## 9. كيف سنقسم السلة إلى Fulfillment Groups؟

### ما يفعله النظام اليوم

* منتجات المتجر: **متجر واحد فقط** وإلا 400. لا تقسيم إلى طلبين لمتجرين.
* كل بند خدمة → **طلب تنفيذي مستقل** (مناسب).
* سطحة/نقل بإحداثيات تخرج من دلو الخدمة إلى محرك التوصيل الموحّد.
* توصيل الخريطة → دلو `delivery` → طلب واحد للمجموعة.

هذا قريب من المراد، لكنه **يرفض** متجرين بدل تقسيمهما، ولا يسمّي المجموعات بوضوح (Store / Service / Transport / Delivery).

### القاعدة المقترحة (بدون جداول جديدة)

المفتاح = `workflow` + `provider_key` (ليس Role جديدة).

| بند السلة | workflow | تجميع |
|---|---|---|
| منتجات نفس `store_id` | store (مطعم أو متجر حسب `stores.type`) | **طلب واحد** |
| منتجات `store_id` مختلف | store | **طلب لكل متجر** |
| سباك / كهرباء / تنظيف / تلميع / غاز / منزلية | service | **طلب لكل بند** (أو لكل مزود إن عُيّن لاحقًا) |
| سطحة / نقل أثاث / نقل مركبات | transport (محرك النقل الحالي، `role=service` + type) | **طلب لكل بند** |
| مندوب / توصيل خريطة / توصيل داخلي | delivery أو internal_delivery | **طلب لكل بند** |

جلسة Checkout واحدة + نفس `customer_id` + نفس مفتاح الـ idempotency مع لاحقة المجموعة.

العميل يرى ملخصًا واحدًا. السجلات التنفيذية لا تُخلط.

لا نغيّر Dispatch / Settlement / Actions في هذه المهمة؛ كل مجموعة تدخل محركها الحالي بعد التأكيد.

---

## 10. أقل تعديل يجعل الأنواع تمر بنفس تجربة السلة

لا نبني سلة Backend ولا نوحّد المحركات.

1. **عقد عنصر موحّد** فوق `items[]` الحالية (حقول workflow/source دون كسر الشكل القديم).  
2. **كل صفحات الاختيار** تُضيف بـ `commit` إلى المسودة — وهذا شبه منجز.  
3. **رفع منع المتجرين** في الواجهة؛ التقسيم عند التأكيد لا عند الإضافة.  
4. **تجميع الخادم** حسب القاعدة أعلاه بدل 400 عند متجرين.  
5. **إبقاء `/checkout` الواجهة الوحيدة**؛ عدم إحياء `cart.js` checkout.  
6. عند «تأكيد الطلب والدفع»: OTP سياق شراء (ربط أو إنشاء Customer) ثم نفس المسودة — بلا بطاقات عضوية.  
7. لا `INSERT` تنفيذي / لا إشعار تاجر أو مندوب أو مزود قبل نجاح OTP والتأكيد.  
8. وسائل الدفع المعروضة تبقى شslots: محفظة / بطاقة / STC لاحقًا — **بدون ربط STC أو تعديل Ledger الآن.**

---

## Unified Cart Contract

شكل البند (فوق الحقول الحالية، بلا هجرة جدول):

```
line_id
workflow          store | service | transport | delivery
source            restaurant | store | supermarket | pharmacy | gas | home_service | tow | furniture | courier | …
provider_id       store_id أو null حتى التعيين
item_id           product_id أو service catalog id
title
unit_price
qty               (1 للخدمات ذات الرحلة الواحدة)
notes
location          pickup / drop / customer — حسب النوع
scheduled_at      إن لزم
data              الحمولة الحالية كما هي (gas_mode، vehicle_category، snapshot توصيل…)
```

السلة = مصفوفة بنود + موقع عميل مشترك اختياري + `payment_method` مختار + totals للعرض فقط (السعر النهائي من الخادم عند التأكيد).

التخزين يبقى `ervenow:order-draft` في localStorage. لا جدول جديد.

قيود الإضافة:

* نفس المنتج في نفس المتجر → زيادة كمية.
* متجر أ + متجر ب → مسموح (مجموعتان لاحقًا).
* متجر + سطحة → مسموح.
* لا يُنشأ Order عند الإضافة.

---

## Unified Checkout Flow

```
تصفح أي قسم
  → إضافة للمسودة
  → /checkout  (مراجعة واحدة)

خطوات الشاشة:
  1. مراجعة البنود (مجموعات للعرض فقط)
  2. عنوان / موقع (مشترك أو لكل مجموعة تحتاجه)
  3. موعد إن كانت المجموعة Service/Transport تحتاجه
  4. ملخص أسعار (خادم عند التأكيد)
  5. وسيلة دفع (ew_pay / بطاقة / COD — STC slot لاحقًا)
  6. «تأكيد الطلب والدفع»

إن لم يُوثَّق الجوال:
  OTP سياق checkout
    موجود Customer → ربط المسودة
    رقم جديد → إنشاء Customer تلقائي (لا اختيار عضوية)
  العودة لنفس /checkout دون فقد المسودة

بعد OTP + تأكيد:
  تقسيم Fulfillment Groups
  إنشاء طلب تنفيذي لكل مجموعة عبر المحرك الحالي
  توجيه: طلب واحد للتتبع إن أمكن، وإلا /my-orders
```

قبل OTP: Draft فقط.  
بعد OTP + تأكيد: Orders تنفيذية.

---

## Fulfillment Grouping Rules

```
group_key =
  store:{store_id}
  | service:{type}:{line_id}
  | transport:{type}:{line_id}
  | delivery:{line_id}
```

* نفس المتجر = مجموعة واحدة = Order واحدة إن بقي محرك المتجر كذلك.  
* متجران = مجموعتان.  
* كل خدمة/نقلة/توصيل بند = مجموعة.  
* لا دمج مطعم + سطحة في صف `orders` واحد.  
* `checkout_session_id` منطقي = مفتاح الـ idempotency الحالي + لاحقة المجموعة (موجود جزئيًا: `:type` و `:svc:idx`).

---

## خارج النطاق الآن

* توحيد Dispatch / Settlement / Actions  
* STC Pay / Ledger  
* جدول سلة في قاعدة البيانات  
* `role=transport`  
* تغيير دورة حالة الطلب داخل كل محرك

---

## خلاصة القرار المطلوب منك

النظام جاهز للبناء **فوق المسودة الحالية** لا فوق سلة جديدة.

الفجوات الحقيقية قبل التنفيذ:

1. منع متجرين في الواجهة/الخادم (يجب أن يصبح تقسيمًا).  
2. OTP الشراء ما زال يفتح `/login?mode=register`.  
3. الإدراج الحالي قد يُبلّغ التاجر/المندوب فور إنشاء الصف.  
4. خدمات كثيرة تطلب جوالًا عند الإضافة لا عند التأكيد.  
5. محركان للسلة في الكود؛ المعتمد هو Order Draft + `/checkout`.

بعد اعتماد العقد والتجميع ننفّذ دون لمس Ledger أو STC أو المحركات الداخلية.
