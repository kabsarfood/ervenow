# Order domain (`shared/domain/orders/`)

هدف هذه الطبقة في **مرحلة التثبيت**: مركز واحد لـ **قراءة** حالة التوصيل و**قواعد الانتقال** دون نقل كل منطق `apps/delivery/service.js` دفعة واحدة (لتجنب كسر الإنتاج).

## الاستخدام المستقبلي

```js
const {
  getEffectiveDeliveryStatus,
  canTransitionDeliveryStatus,
  DELIVERY_STATUS,
} = require("../../shared/domain/orders");
```

## الخطوة التالية (خارج هذا الدمج)

- دمج `createOrder` / `applyStatus` داخل هذه الطبقة مع معاملات DB واحدة.
- توحيد تحديث `status` المالي مع `delivery_status` عبر واجهة واحدة.

راجع: `docs/order-lifecycle.md`, `docs/STABILIZATION-PLAN.md`.
