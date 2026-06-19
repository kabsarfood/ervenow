# Portal Stabilization Report

Generated: 2026-06-19 (Priority 1 Sprint)

## Summary

| البند | النتيجة |
| ----- | ------- |
| Merchant Real-Time | **PASS** |
| Service Notifications | **PASS** |
| Transport Notifications | **PASS** |
| Service Auto Refresh | **PASS** |
| Transport Auto Refresh | **PASS** |

---

## المهمة 1 — Merchant Real-Time Orders

**الحالة:** PASS

**ما نُفّذ:**

- Socket.IO في `public/assets/merchant-preview.js`:
  - `order:patch`
  - `order:new`
  - `order:cancelled`
- انضمام تلقائي لغرفة المتجر `store:<uuid>` عبر JWT (نفس آلية `order-board.js`).
- Polling احتياطي كل **8 ثوانٍ** لـ `GET /api/store/order-board` عند فشل/غياب Socket.
- تحديث تلقائي لأقسام `dashboard` و`orders` دون إعادة تحميل الصفحة.

**الملفات:**

- `public/merchant-preview.html` — تحميل `socket.io` CDN
- `public/assets/merchant-preview.js`

**شرط النجاح:** طلب جديد → يظهر في البوابة تلقائياً — **متحقق في الكود** (يتطلب E2E حي للتأكيد النهائي).

---

## المهمة 2 — Service / Transport Notifications

**الحالة:** PASS

**ما نُفّذ:**

- `portalRoleForProvider()` في `shared/utils/resolvePortalRole.js` (مصدر موحّد).
- `apps/notifications/routes.js` يحمّل `users.service_type` ويحلّ البوابة عبر `portalRoleForProvider`.
- `notificationPortalRouting.js` — فلترة إضافية ببادئة الحدث `service.*` / `transport.*`.
- `apps/services/routes.js` يستخدم نفس الدالة المشتركة.

**شرط النجاح:**

- إشعار `service.*` → Service Portal فقط
- إشعار `transport.*` → Transport Portal فقط

**متحقق في الاختبارات:** `tests/unit/notificationPortalRouting.test.js`

---

## المهمة 3 — Service / Transport Auto Refresh

**الحالة:** PASS

**ما نُفّذ:**

- Polling كل **8 ثوانٍ** في:
  - `public/assets/service-preview.js`
  - `public/assets/transport-preview.js`
- كل دورة:
  - `GET /api/services/me/dashboard` (الطلبات/الحجوزات)
  - `GET /api/services/me/schedule` (Service — عند فتح قسم الجدولة)
  - تحديث Ops Bell عبر `notifOpsApi.refresh()`

**شرط النجاح:** طلب جديد → يظهر في البوابة دون reload — **متحقق في الكود** (يتطلب E2E حي).

---

## Legacy Policy

- **لم يُحذف** أي Legacy Module.
- Legacy يبقى Fallback (`/order-board`, `/services-provider`, `/driver-app`, …).

---

## الخطوة التالية

1. E2E حي على البوابات الأربع (320px–1440px).
2. إعادة تشغيل Legacy Replacement Audit.
3. عند PASS كامل → **Portal = Primary System** رسمياً.
