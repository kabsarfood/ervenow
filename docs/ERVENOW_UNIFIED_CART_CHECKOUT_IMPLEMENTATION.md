# ERVENOW — تنفيذ Unified Cart / Checkout / Fulfillment Groups

**التاريخ:** 2026-09-22  
**النطاق:** Cart Contract + `/checkout` + OTP سياق شراء + تقسيم Groups فوق المحركات الحالية.  
**لم يُغيَّر:** Dispatch · Settlement · Unified Actions · Ledger · STC Pay · `PUBLIC_ORDERING`.

---

## 1. الملفات المعدّلة

### عقد السلة والتجميع
- `shared/orderDraft/unifiedCartLine.js` (جديد)
- `shared/orderDraft/orderDraftSchema.js`
- `shared/orderDraft/verticalDraftBridge.js`
- `shared/utils/cartDeliverySnapshot.js`

### الواجهة
- `public/assets/order-draft-store.js` — لا تُمسح مسودة الضيف
- `public/assets/order-draft-vertical.js` — خلط متاجر + مجموعات + جوال اختياري عند الإضافة
- `public/assets/pre-cart-delivery.js`
- `public/assets/cart.js` — إن وُجد Draft Vertical يكتب إليه لا إلى `localStorage.cart`
- `public/assets/checkout-engine.js` — عرض Groups + OTP داخل الصفحة
- `public/assets/checkout-page.css`
- `public/checkout.html`
- `public/service-book.html` · `public/gas-delivery.html` · `public/car-polishing.html`

### الخادم
- `apps/checkout/service.js` — تقسيم متجر/توصيل إلى دفعات تنفيذية
- `apps/core/routes.js` — `checkout_customer` ينشئ Customer دون شاشة العضوية

### اختبارات
- `tests/unit/unifiedCartFulfillment.test.js` (جديد)
- تحديث: `verticalDraftBridge` · `loginOtpFirst` · `checkoutEnginePhase2`

نسخ مطابقة إلى `ervenow-frontend/` لنفس ملفات الواجهة.

---

## 2. شكل Unified Cart النهائي

التخزين الرسمي: `localStorage["ervenow:order-draft"]`.

كل بند يُطبَّع عند القراءة/الإضافة مع الإبقاء على `type` و`data` القديمة:

```
{
  id, type, title, price, data,          // توافق قديم
  workflow,     // store | service | transport | delivery
  source,       // restaurant | pharmacy | gas | tow | …
  provider_id,  // store_id إن وُجد
  item_id,      // product_id إن وُجد
  qty, notes, location, scheduled_at,
  group_key     // store:{id} | service:{type}:{line} | transport:{type}:{line} | delivery:{line}
}
```

لا جدول Cart في قاعدة البيانات.

---

## 3–4. مثال سلة مختلطة والتقسيم

بنود المسودة:

1. مطعم أ — وجبة (`store_id=a`, `type=restaurant`)
2. صيدلية ب — دواء (`store_id=b`, `type=pharmacy`)
3. سطحة (`type=pickup_truck`)

Fulfillment Groups عند Checkout:

| المجموعة | المفتاح | المحرك |
|---|---|---|
| طلبك من مطعم مطعم أ | `store:a` | Store — Order واحدة |
| طلبك من صيدلية ب | `store:b` | Store — Order أخرى |
| خدمة سطحة | `transport:pickup_truck:{line_id}` | Transport/خدمة حالية — Order مستقلة |

لا صف `orders` يجمع مطعمًا مع سطحة.

---

## 5. الحفاظ على السلة أثناء OTP

- المسودة تبقى في `ervenow:order-draft`؛ OTP نافذة فوق `/checkout` بلا انتقال إلى `/login`.
- `applySessionDraftPolicy` لم يعد يمسح مسودة الزائر غير المسجّل.
- بعد نجاح OTP يُحفظ التوكن وتُستأنف `confirmOrder` على نفس المسودة.

---

## 6. متى يُكتب أول سجل في `orders`

فقط بعد:

1. نجاح OTP سياق `checkout_customer` (أو جلسة Customer قائمة)
2. ضغط «تأكيد الطلب والدفع»
3. نجاح `POST /api/order/create` → `runCheckoutInsert`

قبل ذلك: LocalStorage فقط. لا INSERT.

---

## 7. Guest غير موثّق

- `POST /api/order/create` ما زال `requireAuth`.
- الواجهة لا تحوّل إلى إنشاء عضوية؛ تعرض OTP Checkout.
- بدون توكن: 401، لا طلب تنفيذي، لا إشعار تاجر/مندوب/مزود.

---

## 8. ما بقي من `cart.js`

الملف موجود للتوافق (`cart.html` إن فُتح مباشرة).  
`GET /cart` ما زال 302 إلى `/checkout`.  
الإضافة من الواجهة الحية تمر عبر `ErvenowOrderDraftVertical.commit`.  
إن وُجد المحرك الرسمي، `addToCart` لا يكتب `localStorage.cart`.

---

## 9. الاختبارات

13 مجموعة وحدة ذات صلة: **79 اختبارًا ناجحًا** (8+5 مجموعات في دفعتين).

يشمل: تجميع السلة المختلطة، السماح بمتجرين، OTP-first بدون كسر التسجيل العام، `checkout_customer` ينشئ Customer، Checkout بلا `mode=register`.

---

## 10. هل النظام جاهز لتفعيل `PUBLIC_ORDERING`؟

**لا.** لم يُفعَّل في هذه المهمة.

السلة وCheckout وOTP جاهزة خلف البوابة الحالية. فتح الطلب العام يحتاج مراجعة مستقلة بعد التأكد من البيئة الحية (توثيق، تسعير الخادم، عدم وصول المسودة للجهات).

---

## خارج النطاق (كما طُلب)

Dispatch · Settlement · Unified Actions · STC Pay · Ledger · جدول سلة · `role=transport`.
