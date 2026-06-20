# Internal Delivery Root Cause Report

**التاريخ:** 20 يونيو 2026  
**القرار المنفّذ:** **الخيار B** للبوابة + **إعادة ربط Driver Flow** (REUSE)

---

## 1. ما هو `internal_delivery`؟

نوع طلب `service_type: internal_delivery` — توصيل داخلي (شحنة من نقطة إلى نقطة) يُنشأ عبر checkout (`checkout-engine.js`) ويُخزَّن في `orders` مع `portal_type: transport`.

---

## 2. لماذا يبدو «معطّلاً» في Transport Portal؟

| الطبقة | السلوك | الملف |
|--------|--------|-------|
| **فلترة قائمة المزود** | `internal_delivery` **مستبعد صراحة** من حجوزات Transport/Service | `apps/services/routes.js` → `filterBookingsForProvider()` سطر ~101 |
| **حجز Reserve** | 403: «للمندوب فقط — استخدم تطبيق المندوب» | `apps/services/routes.js` → `POST /bookings/:id/reserve` سطر ~740–741 |
| **واجهة Transport** | تبويب/فلتر «توصيل داخلي» **يعرض طلبات لا يمكن حجزها** | `transport-preview.js` → `TRANSPORT_TYPES.internal_delivery` |

---

## 3. متى تم تعطيله؟

**قرار معماري مقصود** أثناء **Flow Separation 3.0** (يونيو 2026):

- `internal_delivery` يُصنَّف ضمن `TRANSPORT_PORTAL_TYPES` للتوجيه (`resolvePortalRole.js`) — للعرض/التسعير فقط.
- **التنفيذ التشغيلي** نُقل إلى **مسار المندوب** (`driverDispatchOrders.js` → `isInternalDeliveryOrder()` → `true`).
- الإشعار عند النشر: `unifiedOrderStatus.js` → `notifyInternalDeliveryOrder()` (`internalDeliveryNotify.js`).
- WhatsApp للمندوبين يوجّه سابقاً إلى `/driver` (Legacy).

**ليس Regression عشوائي** — بل **فصل أدوار**: Transport Provider ≠ Driver لطلبات التوصيل الداخلي.

---

## 4. الملف المسؤول

| الملف | الدور |
|-------|-------|
| `apps/services/routes.js` | حجب الحجز + فلترة القائمة |
| `shared/utils/driverDispatchOrders.js` | تضمين `internal_delivery` في طابور المندوب |
| `shared/services/internalDeliveryNotify.js` | إشعار + WhatsApp للمندوبين |
| `shared/services/unifiedOrderStatus.js` | trigger عند draft→pending |
| `ervenow-frontend/assets/transport-preview.js` | UI يعرض نوعاً غير قابل للتنفيذ من البوابة |

---

## 5. هل يمكن إعادة استخدام Driver Flow الحالي؟

**نعم — 100% REUSE.**

المسار التشغيلي الصحيح:

```
checkout (internal_delivery)
  → orders (pending)
  → internalDeliveryNotify → drivers
  → Driver Portal Ready Queue (filterDriverDispatchOrders)
  → accept → picked_up → delivering → delivered
  → deliveredFinancialSettlement
```

لا حاجة لـ `POST /bookings/:id/reserve` من Transport Portal.

---

## 6. القرار المنفّذ (G1-R Final)

### الخيار B — Transport Portal

- **إزالة** `internal_delivery` من فلاتر وأنواع Transport UI.
- **عدم** محاولة تفعيل Reserve من Transport (يبقى محجوباً في Backend — صحيح).

### إعادة الربط — Driver Portal

- تحديث رابط WhatsApp إلى `/driver-preview`.
- التأكيد أن `driver-preview` يعرض طلبات `internal_delivery` عبر `legacy_open` / dispatch filter.

---

## 7. الخلاصة

| السؤال | الجواب |
|--------|--------|
| لماذا معطّل؟ | **مقصود** — ليس لـ Transport Provider |
| Regression؟ | **لا** — فصل أدوار |
| REUSE Driver Flow? | **نعم** |
| الإجراء | B في Transport UI + Driver REUSE |
