# تقرير Unified Available Actions — قراءة فقط

تاريخ: 21 سبتمبر 2026

هذه المرحلة **قراءة فقط**. لم يُمس أي Write API ولم يُبنَ Unified Action Dispatcher.

---

## 1. تصحيح `current_actor_type`

تعريف الحقل: الطرف المسؤول تشغيليًا عن الخطوة الحالية للطلب.

عند:

- `status_unified = completed`
- أو `status_unified = cancelled`

تصبح القيمة:

```text
current_actor_type = null
```

لا تعني Driver أو Merchant «آخر من نفّذ».
لم نُضف `last_actor_type`.

---

## 2. الدالة الجديدة

`availableActionsForRole(order, actor)`

الملف:

`shared/domain/orders/availableActions.js`

تُحسب من المحرك الحالي حسب:

- `workflow`
- `status_unified`
- الدور Role
- علاقة المستخدم بالطلب
- الحالات الأصلية (`delivery_status` / `cp_status` / `sp_status`) عند الحاجة

الاستجابات الموحدة تضيف:

```json
"available_actions": ["mark_ready"]
```

حسب المستخدم الحالي. الحقل للوصف فقط، لا يُنفَّذ منه شيء بعد.

الواجهات لم تُخفِ أزرارًا ولم تغيّر سلوكها.

للمراقبة أثناء التطوير:

```js
localStorage.setItem("erv_unified_actions_log", "1")
```

---

## 3. Action Policy Matrix (من الكود الفعلي)

| Workflow | Role | Unified Status | Allowed Action | Existing API | Original transition |
| --- | --- | --- | --- | --- | --- |
| store | merchant | created | accept | PATCH /api/order/:id/status | pending/new → accepted |
| store | merchant | accepted | start_preparing | PATCH /api/order/:id/status | accepted → preparing |
| store | merchant | preparing | mark_ready | PATCH /api/order/:id/status | preparing → ready |
| store | merchant | ready / assigned / بعدها | — | — | انتظار المندوب |
| store | driver | ready بدون driver | accept_delivery | POST /api/driver/accept/:id | ready → picked_up + driver_id |
| store | driver | picked_up | start_delivery | POST /api/driver/start-delivery/:id | picked_up → delivering |
| store | driver | in_transit | complete | POST /api/driver/complete-order/:id | delivering → delivered |
| store | customer | created / accepted | cancel | POST /api/order/:id/cancel | → cancelled_by_customer |
| store | customer | completed بدون تقييم | review | POST /api/order/:id/rate | كتابة rating |
| store | admin | غير نهائي | cancel · assign_driver | cancel + POST /api/admin/orders/:id/assign-driver | إسناد / إلغاء |
| internal_delivery / delivery | driver | created | accept_delivery | POST /api/driver/accept/:id | pending → accepted |
| internal_delivery / delivery | driver | assigned | start_delivery و complete | start-delivery أو complete-order | accepted → delivering أو delivered مباشرة |
| service مرحلة منزلية / أسطوانة | service | created | accept | POST /api/services/bookings/:id/reserve | new/pending → accepted |
| service تلميع | service | created | accept + reject | reserve / POST .../reject | رفض بدون إغلاق الطلب |
| service مرحلة | service | assigned / scheduled | mark_en_route | PATCH .../status `{sp_status:on_the_way}` | → on_the_way |
| service مرحلة | service | in_transit | start_service | PATCH `{sp_status:in_progress}` | → in_progress |
| service مرحلة | service | in_progress | complete | POST .../complete | → delivered |
| service عامة غير مرحلة | service | assigned | mark_en_route + complete | PATCH delivering أو POST complete | يمكن تخطي «في الطريق» |
| service غاز مركزي | service | assigned | start_service | POST complete `{step:provider}` | accepted → delivering |
| service غاز مركزي | service | in_transit | complete | POST complete + actual_liters | → delivered |
| transport | transport | created | accept | POST .../reserve | → accepted |
| transport | transport | assigned | complete | POST .../complete | accepted → delivering (نصف الإتمام) |
| service / transport | customer | in_transit | confirm | POST .../complete كمشتري | delivering → delivered |
| الكل | أي دور | completed / cancelled | لا تشغيل | — | current_actor_type = null |

ملاحظات:

- لا يوجد `reject` للتاجر في المحرك.
- لا يوجد `reorder`.
- `review` ليس جزءًا من تنفيذ الطلب.

---

## 4. نتائج الاختبارات

```text
5 suites
60 tests
كلها نجحت
```

شملت:

- دورة المتجر: created → accepted → preparing → ready → assigned → picked_up → in_transit → completed
- من يرى ماذا في كل مرحلة: Customer · Merchant · Driver · Admin
- دورة الخدمة: created → assigned → scheduled → in_transit → in_progress → completed
- دورة النقل: created → assigned → in_transit → completed
- `internal_delivery` يستخدم صلاحيات Driver وليس Transport
- الحالات النهائية: `current_actor_type = null` ولا Action تشغيلية (إلا `review` للعميل إن لم يُقيَّم)

---

## 5. فروقات UI × Backend

### 1) هل يوجد زر في UI لا ينبغي أن يكون متاحًا؟

- **my-orders**: يخفي الإلغاء إذا وُجد `driver_id` حتى في `accepted`. الـBackend يسمح بالإلغاء ما دام `draft | new | pending | accepted` (ما عدا تلميع مقبول من مزود). الواجهة أضيق من المحرك.
- **driver-preview**: يظهر «بدء التوصيل» على `accepted` لطلبات المتجر. الـBackend يرفض `accepted → delivering` للمتجر ويجب الاستلام أولًا. في الواقع `accept_delivery` للمتجر يقفز إلى `picked_up`، لذلك الزر نادرًا ما يُضغط على متجر بحالة `accepted`.

### 2) هل يوجد Action يدعمها Backend ولا يوجد لها زر؟

- `confirm` للعميل بعد إتمام المزود (نقل / خدمة عامة). المعاينات تقول «بانتظار تأكيد العضو» دون زر في my-orders.
- `complete` من `accepted` للتوصيل الداخلي (تخطّي delivering). الـUI يظهر فقط «بدء التوصيل».
- `PATCH /api/order/:id/status` للمندوب يكرر start/complete.
- `POST /api/delivery/orders/:id/accept|cancel|rate` توازي مسارات `/api/order/...` و `/api/driver/...`.
- الإدارة: PATCH واسع لأي انتقال صالح، غير ممثَّل بالكامل في `available_actions`.

### 3) هل توجد نفس Action بأكثر من API؟

نعم:

- الإلغاء: `/api/order/:id/cancel` و `/api/delivery/orders/:id/cancel`
- التقييم: مسارات order و delivery
- قبول المندوب: `/api/driver/accept/:id` و `/api/delivery/orders/:id/accept`
- تغيير الحالة: `PATCH /api/order/:id/status` مقابل start-delivery / complete-order / bookings/status

### 4) هل توجد انتقالات حالة يقوم بها أكثر من Role؟

- `complete` / التسليم: مندوب، مزود، عميل (تأكيد)، إدارة
- `cancel`: عميل وإدارة. مزود التلميع لديه `cancel_task` وهو إعادة نشر لا إلغاء مالي
- `accept` اسم مشترك لتاجر (PATCH) ومزود (reserve) — محركان مختلفان

### 5) ما أكثر Action خطورة لو وحدناها الآن؟

**`complete`**

تلمس التسوية، محفظة المزود/المندوب، OTP المتجر، إتمام الخدمة بخطوتين (مزود ثم عميل)، ولترات الغاز.

ثاني الأخطر: **`accept_delivery`**

سباق مناديب + قفزة ready → picked_up + GPS + حد المديونية.

---

## 6. أول Action مقترحة للتوحيد لاحقًا

**`start_preparing`**

تاجر فقط: `accepted → preparing`

سبب انخفاض المخاطر:

- دور واحد
- API واحد موجود: `PATCH /api/order/:id/status`
- بلا إسناد مندوب
- بلا تسوية
- بلا سباق قبول
- الزر في merchant-preview يطابق السياسة أصلًا

لم يُنشأ:

```text
POST /api/orders/:id/action
```

بعد المراجعة يمكن بناء Unified Action Dispatcher فوق المحركات الحالية تدريجيًا، بدءًا من `start_preparing`.

---

## 📋 نسخ التقرير

حدد البلوك التالي بالكامل ثم انسخ، أو افتح الملف:

`docs/ERVENOW_UNIFIED_AVAILABLE_ACTIONS.copy.txt`

