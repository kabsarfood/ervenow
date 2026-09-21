# تقرير Unified Action — `start_preparing` فقط

تاريخ: 21 سبتمبر 2026

المرحلة: أول مسار في Unified Action Dispatcher فوق المحرك الحالي.
لم يُنفَّذ: `accept` · `mark_ready` · `accept_delivery` · `start_delivery` · `complete` · `cancel`.

لم يُغيَّر: جدول `orders` · `delivery_status` · `status` · التسوية · Dispatch · Wallet · تعيين المندوب · APIs القديمة.

---

## 1. الملفات المعدلة

| ملف | الدور |
|---|---|
| `shared/domain/orders/unifiedActionDispatcher.js` | Dispatcher الجديد |
| `shared/domain/orders/index.js` | تصدير `dispatchUnifiedOrderAction` |
| `apps/order/routes.js` | `POST /api/order/:id/action` |
| `public/assets/merchant-preview.js` | زر «بدء التجهيز» فقط |
| `public/merchant-preview.html` | cache-bust `?pfv=20260921u4` |
| `tests/unit/unifiedActionDispatcher.test.js` | اختبارات المسار والرفض |
| `ervenow-frontend/` | نسخة مزامنة `npm run frontend:sync` |

---

## 2. شكل Unified Action Dispatcher

غلاف سياسة فوق المحرك الحالي. ليس محرك حالات ثانيًا.

المسار المعتمد (مفرد `order` حسب `app.use("/api/order")`):

```http
POST /api/order/:id/action
Authorization: Bearer <merchant>
Content-Type: application/json

{ "action": "start_preparing" }
```

الإجراء الوحيد المسجّل في `SUPPORTED_ACTIONS`:

- الدور: Merchant (`store` / `merchant` / `restaurant`)
- الملكية: `merchantOwnsOrder`
- `workflow = store`
- `status_unified = accepted`
- `start_preparing` موجودة في `available_actions`
- ثم الكتابة: `delivery_status = preparing`

ترتيب البوابات — كلها قبل أي كتابة:

1. `action` مدعوم، وإلا `400 unsupported action`
2. الطلب موجود، وإلا `404`
3. الدور Merchant، وإلا `403 Forbidden`
4. الملكية، وإلا `403 Forbidden`
5. `workflow = store`، وإلا `409`
6. `status_unified = accepted`، وإلا `409 action not available`
7. الإجراء في `available_actions`، وإلا `409 action not available`
8. استدعاء المحرك الحالي

---

## 3. كيف أعاد استخدام المحرك الحالي

لا Transition جديد.

بعد نجاح البوابات يستدعي نفس دالة `PATCH /api/order/:id/status`:

```js
patchUnifiedOrderStatus(sb, id, "preparing", appUser)
```

نفس انتقال `accepted → preparing`، ونفس قواعد الملكية والانتقال والإشعارات والبث.

`PATCH /api/order/:id/status` بقي يعمل كما هو.

---

## 4. الاختبارات والنتائج

الملف: `tests/unit/unifiedActionDispatcher.test.js`

النتيجة: **9/9** ناجحة. مع Read Model و Available Actions: **59/59**.

### المسار السعيد

`accepted` → `start_preparing` → `preparing`

- يستدعي المحرك بـ `nextStatus: "preparing"`
- `status_unified = preparing`
- `current_actor_type = merchant`
- التاجر بعدها: `available_actions = ["mark_ready"]`

بعد الانتقال، الإسقاط نفسه يُقرأ من:

- Customer API / Read Model
- Merchant API / Read Model
- Admin API / Read Model

كلها: `status_unified = preparing` و `current_actor_type = merchant`.

### الرفض بدون تعديل الطلب

| الحالة | HTTP | كتابة؟ |
|---|---|---|
| Customer يحاول `start_preparing` | 403 | لا |
| Driver يحاول `start_preparing` | 403 | لا |
| Merchant آخر على طلب ليس لمتجره | 403 | لا |
| الطلب ليس store workflow | 409 | لا |
| الطلب ليس accepted (`pending`) | 409 | لا |
| الطلب completed (`delivered`) | 409 | لا |
| الطلب cancelled | 409 | لا |
| Action غير مدعومة (`mark_ready`) | 400 | لا |

Smoke حي بدون توكن:

- `POST /api/order/:id/action` → `401`
- `PATCH /api/order/:id/status` القديم → `401`

لم يُشغَّل مسار سعيد ضد قاعدة البيانات الحقيقية حتى لا يُعدَّل طلب حي.

---

## 5. مثال Request / Response

### نجاح

```http
POST /api/order/es-21-101/action
```

```json
{ "action": "start_preparing" }
```

```json
{
  "ok": true,
  "action": "start_preparing",
  "order_id": "es-21-101",
  "workflow": "store",
  "previous_status": "accepted",
  "previous_status_unified": "accepted",
  "status_unified": "preparing",
  "current_actor_type": "merchant",
  "available_actions": ["mark_ready"],
  "order": {}
}
```

حقل `order` هو Unified Read Model بعد التحديث (فيه `delivery_status` الأصلي أيضًا).

### رفض

```json
{ "ok": false, "error": "Forbidden" }
```

أو:

```json
{ "ok": false, "error": "action not available" }
```

أو:

```json
{ "ok": false, "error": "unsupported action" }
```

---

## 6. زر merchant-preview

صفحة: `/merchant-preview`

| الزر | المسار |
|---|---|
| قبول الطلب (Accept) | القديم `PATCH /api/order/:id/status` |
| بدء التجهيز (Start Preparing) | **Unified Action** `POST /api/order/:id/action` |
| جاهز للاستلام (Ready) | القديم |
| المندوب (Driver) | القديم |
| إكمال (Complete) | القديم |

الكود:

```js
if (st === "preparing") {
  await api("/api/order/" + encodeURIComponent(id) + "/action", {
    method: "POST",
    body: { action: "start_preparing" },
  });
}
```

الملف يُخدم بـ `?pfv=20260921u4`.

النقر الحي لم يُختبر في هذه الجلسة: الصفحة أظهرت شاشة تسجيل دخول التاجر.

`merchant-dashboard` و `order-board` ما زالا يستخدمان `PATCH` القديم لهذه الحركة — مقصود في هذه المرحلة.

---

## 7. المشاكل

- لا مشكلة في العقد أو بوابات الرفض أو إعادة استخدام المحرك.
- المسار السعيد الحي لم يُشغَّل على طلب حقيقي.
- الصفحات الأخرى غير `merchant-preview` لم تُنقل.
- أي Action غير `start_preparing` تُرفض بـ `400 unsupported action` حتى لو كانت في `available_actions`.

---

## الخلاصة

Dispatcher حقيقي فوق المحرك الحالي لفعل واحد:

`accepted → start_preparing → preparing`

جاهز للمراجعة قبل نقل Action ثانية.

---

## 📋 نسخ التقرير

حدد البلوك التالي بالكامل ثم انسخ، أو افتح الملف:

`docs/ERVENOW_UNIFIED_ACTION_START_PREPARING.copy.txt`

```text
تقرير Unified Action — start_preparing فقط
تاريخ: 21 سبتمبر 2026

لم يُنفَّذ: accept · mark_ready · accept_delivery · start_delivery · complete · cancel
لم يُغيَّر: جدول orders · delivery_status · status · التسوية · Dispatch · Wallet · تعيين المندوب · APIs القديمة

1) الملفات المعدلة
- shared/domain/orders/unifiedActionDispatcher.js
- shared/domain/orders/index.js
- apps/order/routes.js
- public/assets/merchant-preview.js
- public/merchant-preview.html  (?pfv=20260921u4)
- tests/unit/unifiedActionDispatcher.test.js
- ervenow-frontend/ عبر npm run frontend:sync

2) شكل Unified Action Dispatcher
POST /api/order/:id/action
{ "action": "start_preparing" }

غلاف سياسة فوق المحرك الحالي. ليس محرك حالات ثانيًا.
الإجراء الوحيد: start_preparing
الدور: Merchant (store / merchant / restaurant)
الملكية: merchantOwnsOrder
workflow = store
status_unified = accepted
start_preparing في available_actions
ثم الكتابة: delivery_status = preparing

البوابات قبل أي كتابة:
1. action مدعوم وإلا 400 unsupported action
2. الطلب موجود وإلا 404
3. الدور Merchant وإلا 403 Forbidden
4. الملكية وإلا 403 Forbidden
5. workflow = store وإلا 409
6. status_unified = accepted وإلا 409 action not available
7. الإجراء في available_actions وإلا 409 action not available
8. استدعاء المحرك الحالي

3) كيف أعاد استخدام المحرك الحالي
patchUnifiedOrderStatus(sb, id, "preparing", appUser)
نفس PATCH /api/order/:id/status
نفس انتقال accepted → preparing
نفس قواعد الملكية والانتقال والإشعارات والبث
الـAPI القديمة بقيت تعمل

4) الاختبارات والنتائج
tests/unit/unifiedActionDispatcher.test.js
9/9 ناجحة. مع Read Model و Available Actions: 59/59

سعيد: accepted → start_preparing → preparing
- nextStatus: preparing
- status_unified = preparing
- current_actor_type = merchant
- available_actions للتاجر = ["mark_ready"]
Customer / Merchant / Admin يقرأون بعدها نفس status_unified و current_actor_type

رفض بدون كتابة:
- Customer → 403
- Driver → 403
- Merchant آخر → 403
- ليس store workflow → 409
- ليس accepted → 409
- completed → 409
- cancelled → 409
- Action غير مدعومة (mark_ready) → 400

Smoke حي بدون توكن: POST /action → 401 و PATCH /status القديم → 401
لم يُشغَّل مسار سعيد ضد قاعدة حقيقية

5) مثال Request / Response
POST /api/order/es-21-101/action
{ "action": "start_preparing" }

{
  "ok": true,
  "action": "start_preparing",
  "order_id": "es-21-101",
  "workflow": "store",
  "previous_status": "accepted",
  "previous_status_unified": "accepted",
  "status_unified": "preparing",
  "current_actor_type": "merchant",
  "available_actions": ["mark_ready"],
  "order": {}
}

رفض: { "ok": false, "error": "Forbidden" }
أو "action not available" أو "unsupported action"

6) زر merchant-preview
Accept → PATCH القديم
بدء التجهيز → POST /api/order/:id/action { action: "start_preparing" }
Ready / Driver / Complete → القديم
النقر الحي لم يُختبر (شاشة دخول التاجر)
merchant-dashboard و order-board ما زالا على PATCH القديم — مقصود

7) المشاكل
لا خلل في العقد أو الرفض أو إعادة استخدام المحرك
المسار السعيد الحي لم يُشغَّل على طلب حقيقي
الصفحات الأخرى لم تُنقل
أي Action غير start_preparing تُرفض بـ 400 unsupported action

الخلاصة: Dispatcher حقيقي فوق المحرك الحالي لفعل واحد
accepted → start_preparing → preparing
جاهز للمراجعة قبل نقل Action ثانية
```

