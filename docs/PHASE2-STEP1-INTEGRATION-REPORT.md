# STABILIZATION Phase 2 — الخطوة 1 (Integration / Contract Tests)

**الحالة:** مكتملة ومثبتة (`npm test` — 100% نجاح).  
**لم يُنفَّذ بعد:** الخطوات 2–6 من طلب المستخدم (تُؤجَّل حتى اعتماد هذه الخطوة).

---

## 1) ما الذي تغطيه الاختبارات؟

### أ) تكامل منطق إنشاء الطلب (مساران → نفس النواة)

| الملف | الغرض |
|--------|--------|
| `tests/integration/deliveryOrderEntry.parity.test.js` | يختبر `runUnifiedDeliveryOnlyCreate` (الذي يخدم `POST /api/delivery/orders` و`POST /api/order/create` لفرع التوصيل): |
| | • **نفس الإحداثيات والأجور** عند تعطيل بوابة الدفع → نفس `delivery_fee` و`order_number` في mock متسق. |
| | • **نفس خيارات الإنشاء** `{ initialDeliveryStatus, payment_status }` لمساري `delivery` و`order` عندما تكون البوابة معطّلة. |
| | • **فرق متعمّد** عند `ERVENOW_REQUIRE_ORDER_PAYMENT=1`: `delivery` يبقى `pending`، `order` يصبح `draft` (توثيق سلوك التوافق الخلفي). |
| | • **`series_source` / X-Source:** يُطبَّق على مسار `delivery` فقط كما في التصميم الحالي. |

> **ملاحظة:** الاختبار لا يشغّل Express ولا Supabase حقيقياً؛ يثبت **عقد المنطق الموحّد** بعد الـ Consolidation السابق. اختبار HTTP كامل يحتاج بيئة DB أو harness إضافي (خطوة لاحقة اختيارية).

### ب) انتقالات `delivery_status`

| الملف | الغرض |
|--------|--------|
| `tests/unit/deliveryLifecycle.transitions.test.js` | يغطي: `pending→accepted`، `accepted→delivering`، `delivering→delivered`، `accepted→delivered`، مسودة→منشور، ورفض انتقال غير صالح. |
| | يطابق `isAllowedDeliveryStatusTransition` مع `isValidDeliveryTransition` حيث ينبغي. |

**حالة `cancelled`:** الإلغاء يمر عبر `cancelOrderByCustomer` ويضبط `delivery_status` إلى قيمة مثل `cancelled_by_customer` وليس عبر خريطة PATCH الاعتيادية — موثّق ضمنياً بعدم وجود انتقال `→ cancelled` في `isValidDeliveryTransition`.

**`onroad`:** في النموذج **المالي** لـ `orders.status` قد يظهر `onroad`؛ مسار التوصيل الظاهر للمستخدم يعتمد `delivery_status` (`delivering`، إلخ). راجع `docs/order-lifecycle.md`.

---

## 2) الملفات المضافة/المعدّلة

| الملف |
|--------|
| `jest.config.js` |
| `tests/integration/deliveryOrderEntry.parity.test.js` |
| `tests/unit/deliveryLifecycle.transitions.test.js` |
| `package.json` (`jest` devDependency، سكربتات `test` / `test:ci`) |

---

## 3) المخاطر

| خطر | التخفيف |
|-----|---------|
| الاختبارات لا تضرب DB حقيقية | العقد الموحّد مثبت؛ أي تغيير لاحق في `deliveryOrderCreateShared` يجب أن يمرّ بـ `npm test`. |
| اختلاف تسمية `onroad` vs `delivering` | موثّق في هذا التقرير + `order-lifecycle.md`. |

---

## 4) نتائج الاختبارات

```text
Test Suites: 2 passed, 2 total
Tests:       13 passed, 13 total
```

الأمر: `npm test`

---

## 5) هل النظام مستقر بعد التعديلات؟

- **كود الإنتاج:** لم يُعدَّل في هذه الخطوة (إضافة اختبارات + Jest فقط).
- **السلوك الحالي:** يبقى كما هو؛ الاختبارات تُثبت خصائص التوافق بين المسارين والانتقالات.
- **الجاهزية للخطوة التالية:** نعم — بعد اعتمادك يمكن البدء بـ **Payment alignment** (`ERVENOW_ENFORCE_DELIVERY_PAYMENT`) دون كسر ما سبق إن بقي الاختبار أخضر.
