# ERVENOW Operational Fixes — Phase 1 Report

**التاريخ:** 2026-06-05

---

## 1. Store Order Workflow — ✅ مُنفَّذ

### دورة الحياة الجديدة

```
pending → accepted → preparing → ready → picked_up → delivering → delivered
```

### Backend

| الملف | التغيير |
|-------|---------|
| `shared/domain/orders/constants.js` | `preparing`, `ready`, `picked_up` |
| `shared/utils/helpers.js` | FSM + `deliveryLifecycleIndex` |
| `shared/utils/deliveryStateMachine.js` | انتقالات مسموحة |
| `shared/domain/orders/orderStatus.js` | alias `picked` → `picked_up` |
| `shared/services/unifiedOrderStatus.js` | صلاحيات المتجر، إشعار العميل، إشعار المندوب عند `ready` |
| `shared/jobs/checkoutDispatch.js` | تأجيل إشعار المندوب لطلبات `store`/`restaurant` حتى `ready` |

### Frontend

| الملف | التغيير |
|-------|---------|
| `public/assets/merchant-order-workflow.js` | PATCH + أزرار + تسميات |
| `public/merchant-dashboard.html` | عمود «إجراء» + Socket.IO refresh |
| `public/assets/merchant-dashboard.css` | زر الإجراء |

### API

`PATCH /api/order/:id/status`  
Body: `{ "delivery_status": "accepted" | "preparing" | "ready" }`

### الإشعارات

| الحدث | المستلم |
|-------|---------|
| `accepted` / `preparing` / `ready` | العميل (in-app) |
| `ready` | المندوب (WhatsApp عبر `notifyNearestDrivers`) |

---

## 2. Gas Delivery Completion — ✅ مُنفَّذ

**`shared/services/completeServiceOrder.js`**

```javascript
isServiceOrderRow: order_type === "service" || order_type === "gas_delivery"
```

طلبات `gas_delivery` تمر الآن بنفس مسار إتمام الخدمات.

---

## 3. الاختبارات — ✅ 146/146

| Suite | التغطية |
|-------|---------|
| `tests/unit/storeOrderWorkflow.test.js` | pending→accepted→preparing→ready + gas row |
| `tests/unit/deliveryLifecycle.transitions.test.js` | مسار محدّث |

```bash
npm test   # 39 suites, 146 tests — 0 failed
```

---

## 4. التحقق اليدوي المقترح

### متجر

1. إنشاء طلب من cart → `pending`
2. `/merchant-dashboard` → «قبول الطلب» → `accepted`
3. «بدء التجهيز» → `preparing`
4. «جاهز للاستلام» → `ready` + إشعار مندوب
5. المندوب: `picked_up` → `delivering` → `delivered`

### غاز

1. `gas-delivery.html` → cart → checkout
2. `services-provider.html` → reserve → complete
3. التأكد أن `complete` لا يُرجع `not a service order`

---

## 5. ملاحظات

- **المطعم** يستخدم نفس workflow المتجر (`order_type: restaurant`).
- **`picked`** ما زال alias لـ **`picked_up`** للتوافق مع واجهة المندوب القديمة.
- **DB CHECK** على `delivery_status`: إن وُجد constraint قديم في Supabase، نفّذ migration لإضافة القيم الجديدة.

---

**الحالة:** Phase 1 مكتمل — جاهز للاختبار على staging.
