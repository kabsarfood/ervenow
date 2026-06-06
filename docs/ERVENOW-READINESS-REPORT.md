# ERVENOW — تقرير جاهزية الاستقرار

**التاريخ:** 2026-06-05  
**نطاق المهمة:** Stabilization Mission (المهام 1–5)

---

## ملخص تنفيذي

| المهمة | الحالة | معيار النجاح |
|--------|--------|--------------|
| 1 — إصلاح Jest | ✅ مكتمل | 0 Failed Suites |
| 2 — إغلاق Cart V2 | ✅ مكتمل | مصدر طلب واحد |
| 3 — إزالة Legacy B2C | ✅ مكتمل | Legacy = 0 في B2C |
| 4 — Playwright Smoke | ✅ مكتمل | 6/6 ناجح |
| 5 — تقرير الجاهزية | ✅ هذا الملف | — |

---

## نتائج الاختبارات

| Suite | النتيجة |
|-------|---------|
| Jest unit/integration | **38 suites / 141 tests — 100% نجاح** |
| Playwright smoke | **6/6 — 100% نجاح** |

```bash
npm test          # Jest
npm run test:e2e  # Playwright
npm run test:all  # الاثنان معاً
```

---

## المهمة 1 — Jest

**المشكلة:** 11 suite كانت تستخدم `node:test` بينما Jest لا يتعرّف عليها (فارغة) + اختبار شبكة `mapsUrlParser` فاشل.

**الإصلاح:**
- تحويل 10 ملفات إلى Jest (`describe` / `test` / `expect`)
- Mock لـ `fetch` في اختبار روابط Google Maps القصيرة
- إضافة `tests/unit/b2cLegacyRoutes.test.js` لحماية B2C من Legacy

---

## المهمة 2 — Cart V2

**المسار الموحّد:**

```
ErvenowCart (localStorage: cart v2)
  → /cart (cart.html)
  → executeCartCheckout()
  → POST /api/order/create
```

**التحقق:**
- `public/assets/cart.js` — يستدعي `/api/order/create` فقط
- الغاز / الخدمات / الخريطة — `ErvenowServiceCart.add()` → `/cart`
- `order.html` — نموذج إدخال يُغذّي السلة ثم `/cart` (لا إنشاء مباشر)

---

## المهمة 3 — Legacy B2C

**مسارات Legacy المحظورة على B2C:**

| مسار | B2C |
|------|-----|
| `POST /api/checkout` | 0 |
| `POST /api/food/orders` | 0 |
| `POST /api/delivery/create` | 0 |
| `POST /api/delivery/orders` | 0 |

**بديل القراءة/الإلغاء/التقييم للعميل:**

| قديم | جديد |
|------|------|
| `GET /api/delivery/orders` | `GET /api/order/orders` |
| `GET /api/delivery/orders/:id` | `GET /api/order/:id` |
| `POST .../cancel` | `POST /api/order/:id/cancel` |
| `POST .../rate` | `POST /api/order/:id/rate` |

**ما زال Legacy (مقصود — لوحات تشغيل):** `admin-dashboard`, `driver.html`, `driver-app.html`

**حماية CI:** `tests/unit/b2cLegacyRoutes.test.js`

---

## المهمة 4 — Playwright Smoke

| # | المسار | الحالة |
|---|--------|--------|
| 1 | تسجيل الدخول OTP | ✅ |
| 2 | سلة → POST /api/order/create | ✅ |
| 3 | GET /api/order/orders | ✅ |
| 4 | طلب غاز → cart v2 | ✅ |
| 5 | خدمة منزلية → cart | ✅ |
| 6 | نقل مركبة → cart | ✅ |

---

## نسب الجاهزية

### 85% — **تحقّقت**

**السبب:** البنية الأساسية مستقرة — Jest 100%، Cart V2 موحّد، B2C بلا Legacy إنشاء، smoke tests آلية.

**ما ينقص للوصول لـ 90%:** E2E كامل ضد Supabase حقيقي، اختبار لوحات المتجر/المندوب آلياً.

---

### 90% — **قريبة (~88%)**

**السبب:** Playwright يغطي مسارات العميل الأساسية بـ API mocks — لم يُختبر قبول الطلب في لوحة المتجر end-to-end.

**الفجوة (~2%):** smoke «وصول الطلب للمتجر» يحتاج بيئة DB + worker BullMQ.

---

### 95% — **لم تُحقَّق (~82%)**

**السبب:**
- مسارات Legacy ما زالت نشطة على الخادم (لـ B2B/التوافق) — Deprecation headers فقط
- لا اختبار ضغط Artillery كمعيار قبول
- لا chaos tests (انقطاع API/DB)
- E2E بدون mocks محدود

---

### 97% — **هدف التشغيل — (~78%)**

**السبب:** معيار المشروع الأصلي يتطلب:
- فحص يدوي/آلي لجميع الأدوار (6)
- 100/500/1000 طلب ضغط
- صفر أخطاء حرجة في الإنتاج
- إغلاق Legacy backend بالكامل (ليس B2C فقط)

**تقدير:** ~78% — أساس قوي، تشغيل إنتاجي كامل لم يُغلق بعد.

---

## الملفات الحرجة المتبقية

| ملف / مسار | المخاطر |
|------------|---------|
| `apps/checkout/routes.js` | Legacy POST — B2B قد يستخدمه |
| `apps/food/routes.js` | `food_orders` + POST legacy |
| `apps/delivery/routes.js` | POST `/create`, POST `/orders` legacy |
| `public/` vs `ervenow-frontend/` | drift — **شغّل `npm run frontend:sync` بعد كل تعديل** |
| `apps/finance/wallet-server.js` | سطح هجوم إن عُرض علناً |
| OTP memory backend | فقدان OTP عند restart / multi-instance |

---

## المخاطر المتبقية (مرتبة)

1. **P0** — Legacy backend نشط (B2B) — احتمال ازدواجية طلبات
2. **P0** — OTP في الذاكرة في الإنتاج multi-instance
3. **P1** — لا E2E против DB حقيقي
4. **P1** — Artillery غير مدمج في CI
5. **P2** — Worker Redis/BullMQ غير مُختبر في smoke
6. **P2** — صفحة `/cart` بطيئة في Playwright (تحميل كامل) — smoke يتجاوزها عبر API مباشر

---

## أوامر التحقق السريع

```bash
npm test
npm run test:e2e
npm run frontend:sync
```

---

## التوصية التالية (بدون ميزات جديدة)

1. دمج `npm run test:all` في CI
2. تشغيل Artillery كـ gate قبل الإنتاج
3. تفعيل `ERVENOW_OTP_BACKEND=supabase` في الإنتاج
4. مراقبة logs `[DEPRECATED]` لإغلاق Legacy backend تدريجياً

---

**الخلاصة:** ERVENOW جاهزة للتشغيل المحدود والاختبار المكثف. **الجاهزية الفعلية ~85%** — أساس الاستقرار مُنجَز؛ **97%** تتطلب إغلاق backend legacy + ضغط + E2E إنتاجي كامل.
