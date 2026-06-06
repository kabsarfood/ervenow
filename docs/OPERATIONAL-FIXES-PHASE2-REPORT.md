# ERVENOW Operational Fixes — Phase 2 Report

**التاريخ:** 2026-06-05  
**الهدف:** إكمال مسار المندوب بعد Order Board (`ready` → `delivered`)

---

## ما اُنجز

### Backend — `apps/driver/routes.js`

| التغيير | التفاصيل |
|---------|----------|
| Ready Queue | استعلام `delivery_status=ready` بدون `driver_id` |
| Legacy open | `pending/new` **بدون** متجر/مطعم |
| Accept | `ready` + متجر → `picked_up` عبر `patchUnifiedOrderStatus` |
| Accept guard | متجر `pending` → رفض «لم يصبح جاهزاً بعد» |
| Assigned | يشمل `picked_up` |
| Response | `ready_queue`, `active`, `completed` |

### Shared — `shared/utils/driverStoreHandoff.js`

تمييز طلبات المتجر/المطعم عن التوصيل العام.

### Notifications — `unifiedOrderStatus.js`

| الحالة | رسالة العميل |
|--------|--------------|
| `picked_up` | تم استلام الطلب من المتجر |
| `delivering` | المندوب في الطريق |
| `delivered` | تم تسليم الطلب |

### Frontend — `driver.html` + `driver-shell.css`

- أقسام: **جاهزة للاستلام** / **قيد التوصيل** / **مكتملة**
- زر **استلام الطلب** من `ready`
- مسار: `picked_up` → بدء التوصيل → `delivering` → `delivered`
- API موحّد: `/api/driver/start-delivery`, `/api/driver/complete-order`

---

## مسار المتجر/المطعم (بعد Phase 2)

```
pending → accepted → preparing → ready
  → [driver: picked_up] → delivering → delivered
```

---

## Audit V2 (كود)

| السيناريo | النتيجة |
|-----------|---------|
| متجر | ✅ |
| مطعم | ✅ |
| غاز | ❌ (تأكيد عميل) |
| خدمات | ❌ (after_diagnosis) |
| نقل | ❌ (تأكيد عميل) |

**2 / 5** — الهدف المطلوب تحقّق على مستوى الكود.

---

## الاختبارات

```bash
npm test   # 41 suites / 155 tests
```

- `tests/unit/driverStoreHandoff.test.js`

---

## التحقق الحي الموصى به

1. طلب متجر → Order Board → ready  
2. فتح `driver.html` → قسم «جاهزة للاستلام»  
3. استلام → picked_up → بدء التوصيل → delivered  
4. تقييم من `track.html`

---

## Phase 3 (مقترح)

- UI تأكيد عميل للخدمات/غاز/نقل  
- `after_diagnosis` workflow  
- Playwright journey: store E2E
