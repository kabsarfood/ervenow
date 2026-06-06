# Checkout Engine V1 — Phase 1 Report: Order Draft Store

**التاريخ:** 2026-06-06  
**الحالة:** مكتمل — بانتظار اعتماد Phase 1 قبل Phase 2  
**النطاق:** Order Draft Store فقط (بدون حذف Legacy، بدون تعديل على `POST /api/order/create` أو سير العمل)

---

## 1. الهدف

بناء مصدر بيانات جديد للمسودة (`ervenow:order-draft`) يعمل **بالتوازي** مع `localStorage["cart"]` الحالي، مع دالة `migrateFromLegacyCart()` غير تدميرية.

---

## 2. الملفات الجديدة

| الملف | الدور |
|-------|------|
| `shared/orderDraft/orderDraftSchema.js` | Schema، تطبيع، تحقق، استنتاج `service_type` / `provider_id` |
| `shared/orderDraft/migrateFromLegacyCart.js` | `migrateFromLegacyCart()` من cart v2 / مصفوفة legacy |
| `shared/orderDraft/orderDraftStoreCore.js` | `createOrderDraftStore()` — storage-agnostic |
| `public/assets/order-draft-store.js` | طبقة المتصفح (IIFE) → `window.ErvenowOrderDraft` |
| `public/assets/order-draft-store.logic.js` | نقطة دخول Node/اختبارات (re-export من `shared/`) |
| `tests/unit/orderDraftStore.test.js` | 16 اختبار وحدة |
| `docs/CHECKOUT-ENGINE-PHASE1-REPORT.md` | هذا التقرير |

---

## 3. الملفات التي تم لمسها

**لا يوجد تعديل على ملفات موجودة مسبقاً** في Phase 1.  
جميع الملفات أعلاه **جديدة بالكامل**.

لم يُمس: `cart.js`, `cart-ui.js`, `cart.html`, `POST /api/order/create`, orders, dispatch, wallet, tracking, notifications.

---

## 4. Schema — `ervenow:order-draft` v1

```json
{
  "version": 1,
  "service_type": "store | restaurant | gas | service | vehicle | map_delivery | null",
  "provider_id": "string | null",
  "items": [],
  "customer_location": {
    "lat": 0,
    "lng": 0,
    "address": "",
    "fulfillment_mode": "string | null",
    "store_id": "string | null",
    "maps_url": "string | null"
  },
  "payment_method": "string | null",
  "totals": {
    "subtotal": 0,
    "delivery": null,
    "vat": null,
    "platform_fee": null,
    "grand_total": null,
    "delivery_pending": true
  },
  "meta": {
    "created_at": 0,
    "updated_at": 0,
    "source_page": "string | null",
    "migrated_from_cart": false
  }
}
```

### مفاتيح Legacy (قراءة فقط في Phase 1)

| المفتاح | الاستخدام |
|---------|-----------|
| `cart` | cart v2 أو مصفوفة قديمة |
| `ervenow:delivery-location` | موقع التسليم |
| `erv_cart_payment_method` | طريقة الدفع الاحتياطية |

---

## 5. API المتصفح — `window.ErvenowOrderDraft`

| الدالة / الثابت | الوصف |
|-----------------|--------|
| `VERSION`, `STORAGE_KEY`, `LEGACY_CART_KEY` | ثوابت |
| `emptyDraft()`, `normalizeDraft()`, `validateDraft()` | Schema |
| `migrateFromLegacyCart(opts)` | ترحيل يدوي من بيانات legacy |
| `readDraft()`, `writeDraft()`, `clearDraft()` | CRUD المسودة |
| `getItems()`, `isEmpty()` | قراءة سريعة |
| `tryMigrateFromLegacyCart(opts)` | ترحيل تلقائي إذا المسودة فارغة — **لا يحذف cart** |
| `onDraftChange(handler)` | `ervenow:order-draft-changed` + `storage` event |

**التكامل:** لم يُربط بعد بأي صفحة HTML (مقصود — Phase 2). يمكن تحميل السكربت يدوياً للاختبار:

```html
<script src="/assets/order-draft-store.js"></script>
```

---

## 6. `migrateFromLegacyCart()` — السلوك

1. يقرأ cart v2 (`{ version: 2, items, delivery, payment, totals }`) أو مصفوفة legacy.
2. يستنتج `service_type` و `provider_id` من البنود.
3. يبني `customer_location` من: `ervenow:delivery-location` → `cart.delivery` → إحداثيات داخل بنود التوصيل.
4. يأخذ `payment_method` من `cart.payment.method` أو `erv_cart_payment_method`.
5. يأخذ `delivery` من `cart.totals.deliveryFee` أو `runtimeDeliveryFee` (`window.__ervCartDeliveryFee`).
6. يضبط `meta.migrated_from_cart: true`.
7. **لا يحذف** مفتاح `cart`.

`tryMigrateFromLegacyCart()` يتخطى الترحيل إذا المسودة تحتوي بنوداً مسبقاً.

---

## 7. نتائج الاختبارات

### اختبارات Phase 1

```
PASS tests/unit/orderDraftStore.test.js
  16 passed, 16 total
```

تغطية:

- Schema: فارغ، استنتاج أنواع الخدمة، تحقق `provider_id` للمتجر
- Migration: cart فارغ، cart v2 كامل، مصفوفة legacy، مفاتيح delivery/payment
- Store: read/write/clear، ترحيل غير تدميري، تخطي عند مسودة موجودة

### مجموعة CI الكاملة

يُنصح بتشغيل `npm run test:ci` قبل الاعتماد — Phase 1 لم يعدّل ملفات اختبار أو إنتاج قديمة.

---

## 8. ما لم يُنفَّذ (عمداً)

| البند | السبب |
|-------|--------|
| Phase 2 — `checkout.html` / `checkout-engine.js` | بانتظار اعتماد Phase 1 |
| حذف `cart.js` / `cart-ui.js` | ممنوع في Phase 1 |
| ربط الصفحات بـ `ErvenowOrderDraft` | Phase 2 |
| تعديل `POST /api/order/create` | خارج النطاق (KEEP) |
| `npm run frontend:sync` | يُنفَّذ عند الربط في Phase 2 |

---

## 9. مخاطر / ملاحظات

1. **ازدواجية منطق:** `public/assets/order-draft-store.js` يكرر منطق `shared/orderDraft/*` للمتصفح بدون bundler. مصدر الحقيقة للاختبارات: `shared/`. يُوصى بمزامنة يدوية أو خطوة build لاحقاً.
2. **تعارض مسودة + cart:** كلاهما يمكن أن يحتوي بنوداً في نفس الوقت حتى Phase 2 — لا يوجد تزامن تلقائي عكسي من المسودة إلى cart.
3. **`totals.vat` / `platform_fee` / `grand_total`:** تُترك `null` في الترحيل — حسابها في Phase 2 (Unified Checkout).

---

## 10. الخطوة التالية (بعد الاعتماد)

Phase 2: صفحة Unified Checkout + `checkout-engine.js` يقرأ/يكتب `ErvenowOrderDraft` ويستدعي `POST /api/order/create` كما هو.
