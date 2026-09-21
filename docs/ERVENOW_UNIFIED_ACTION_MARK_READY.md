# تقرير حي + Unified Action الثانية — `mark_ready`

تاريخ: 21 سبتمبر 2026

`accept_delivery` لم يُنفَّذ.

---

## أ) الاختبار الحي لـ `start_preparing`

لم يكن هناك طلب `accepted` قائم على متجر التاجر الحقيقي. أُنشئ طلب متجر على نفس المتجر (`restaurant` / workflow=store) ثم قُبل بالمسار القديم `PATCH /status`، ثم اختُبر Dispatcher.

- التاجر: role=`store`، حساب حقيقي معتمد
- الطلب: `ES-LIVE-15745106`
- قبل: `accepted`، `driver_id = null`
- `POST /api/order/:id/action` `{ "action": "start_preparing" }` → **200**

بعدها:

| القارئ | status_unified | current_actor_type | available_actions |
|---|---|---|---|
| Customer GET `/api/order/:id` | preparing | merchant | [] |
| Merchant GET + order-board | preparing | merchant | `["mark_ready"]` |
| Admin GET `/api/order/:id` | preparing | merchant | cancel · assign_driver |

حماية الدورة:

- Driver assignment: لا — `driver_id` بقي `null`
- Settlement: لا
- Wallet / ledger: 0 حركات
- الإشعارات القديمة: نعم — «جاري التنفيذ» للعميل والمتجر (نفس `afterStatusSideEffects`)
- البث: نفس `broadcastOrderPatch` داخل المحرك الحالي

زر merchant-preview ما زال يستدعي هذا المسار لـ «بدء التجهيز». النقر داخل المتصفح لم يُنفَّذ (الصفحة تطلب جلسة تاجر). الاختبار الحي استخدم **نفس POST** من حساب التاجر الحقيقي.

---

## ب) Action الثانية: `mark_ready`

نفس Dispatcher. لا محرك حالات جديد.

```http
POST /api/order/:id/action
{ "action": "mark_ready" }
```

الشروط قبل الكتابة: Merchant · ملكية المتجر · `workflow=store` · `status_unified=preparing` · `mark_ready` في `available_actions`

ثم: `patchUnifiedOrderStatus(..., "ready")` — نفس `preparing → ready` في `PATCH /api/order/:id/status`.

عند `ready` المحرك القديم ينبّه أقرب المناديب. هذا إشعار وليس Driver assignment. `driver_id` يبقى فارغًا. `accept_delivery` لم يُوحَّد.

زر «جاهز للاستلام» في merchant-preview **بقي على PATCH القديم**. لم يُنقل.

---

## 1. الملفات المعدلة

- `shared/domain/orders/unifiedActionDispatcher.js` — إضافة `mark_ready`
- `apps/order/routes.js` — تعليق المسار
- `tests/unit/unifiedActionDispatcher.test.js`
- `scripts/live-start-preparing-probe.js`
- `scripts/live-mark-ready-probe.js`

لم يُغيَّر: جدول orders · التسوية · Wallet · Dispatch APIs · Driver APIs · أزرار Ready/Driver/Complete في المعاينة.

---

## 2. شكل Dispatcher بعد الإضافة

`SUPPORTED_ACTIONS`:

- `start_preparing` → `preparing` إذا `accepted`
- `mark_ready` → `ready` إذا `preparing`

غير ذلك: `400 unsupported action`

---

## 3. إعادة استخدام المحرك

`patchUnifiedOrderStatus(sb, id, "ready", appUser)`

نفس إشعارات «طلبك جاهز» ونفس تنبيه المناديب عند ready. بلا إسناد مندوب.

---

## 4. الاختبارات

وحدة: **17/17** (9 لـ start_preparing + 8 لـ mark_ready)

حي `mark_ready` على نفس الطلب بعد أن أصبح preparing:

- `preparing` → `ready`
- Customer / Merchant / Admin: `status_unified=ready` و `current_actor_type=merchant`
- التاجر: `available_actions=[]` (انتظار المندوب حسب السياسة — لم يُوحَّد accept_delivery)
- `driver_id` ما زال null
- ledger 0 → 0
- إشعاران جديدان: «طلبك جاهز» للعميل والمتجر

---

## 5. مثال Request / Response

```http
POST /api/order/48cebd16-…/action
{ "action": "mark_ready" }
```

```json
{
  "ok": true,
  "action": "mark_ready",
  "workflow": "store",
  "previous_status": "preparing",
  "previous_status_unified": "preparing",
  "status_unified": "ready",
  "current_actor_type": "merchant",
  "available_actions": []
}
```

---

## 6. merchant-preview

- بدء التجهيز → Unified Action (كما سبق)
- جاهز للاستلام → **ما زال القديم**
- لم يُنفَّذ accept_delivery

---

## 7. المشاكل

- لا يوجد طلب accepted جاهز قبل الاختبار؛ أُنشئ طلب حي على المتجر الحقيقي ثم قُبل بالـAPI القديمة.
- نقر زر المعاينة داخل المتصفح لم يُختبر؛ الـPOST الحي مطابق لما يستدعيه الزر.
- بعد `ready` التاجر لا يملك Action تشغيلية في السياسة الحالية. النقطة التالية هي `accept_delivery` (مندوب) — متوقفة للمراجعة.

توقف هنا.
