# ERVENOW — Order lifecycle

## 1. مصدر السجل

**جدول:** `public.orders`  
**المعرّفات:** `id` (UUID)، `order_number` (تسلسل يومي ED-…)، `external_order_id` + `series_source` (جسر POS / كبسار).

## 2. حقلان للحالة (واقع حالي)

| الحقل | الدور | مسارات تمثيلية |
|--------|--------|------------------|
| **`delivery_status`** | دورة التوصيل والواجهات التشغيلية | `PATCH /api/delivery/orders/:id/status`، `apps/delivery/service.js`، `apps/driver/*` |
| **`status`** | نموذج مالي (`new`, `accepted`, `onroad`, `delivered`, `cancelled`) | `PATCH /api/finance/orders/:id/status`، `onDeliveryDelivered` في `apps/finance/hooks.js` |

**ملاحظة معمارية:** يوجد احتمال عدم اتساق إن حُدّث أحدهما دون الآخر؛ طبقة `shared/domain/orders/` توثّق القراءة الآمنة (`getEffectiveDeliveryStatus`) كخطوة أولى نحو التوحيد.

## 3. دورة التوصيل (`delivery_status`)

1. **`draft`** — طلب مدفوع غير مؤكد (بوابة دفع) إن فُعّلت.
2. **`pending` / `new`** — مفتوح للمناديب.
3. **`accepted`** — مندوب عيّن.
4. **`picked`** (اختياري).
5. **`delivering`**
6. **`delivered`**
7. إلغاء: **`cancelled`**, **`cancelled_by_customer`** (حسب الهجرات).

الانتقالات تُتحقق عبر `shared/utils/deliveryStateMachine.js` و`isValidDeliveryTransition` في `shared/utils/helpers.js`.

## 4. إنشاء ونشر

- بعد الإنشاء: `enqueueDeliveryJob("new-order" | "checkout-dispatch")`.
- العامل (`workers/deliveryProcessor.js`): إعادة تسعير OSRM، إشعار مناديب.

## 5. تتبع لحظي

- Socket.IO: `shared/lib/trackingSocket.js` — غرف `order:<uuid>`.

## 6. تسوية مالية عند التسليم

- `onDeliveryDelivered` يربط صف `orders` المالي ويستدعي RPC تسوية — منفصل عن إيداع أجر المندوب في محفظة التشغيل (`ervenow_wallet_*`).

## 7. مستندات ذات صلة

- `docs/architecture.md`
- `docs/wallet-system.md`
- `docs/STABILIZATION-PLAN.md` (خطة توحيد الحالة)
