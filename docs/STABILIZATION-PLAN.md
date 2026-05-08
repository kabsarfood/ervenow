# ERVENOW CORE STABILIZATION — خطة تنفيذ CTO

**آخر تحديث:** تم تنفيذ دفعة «المرحلة 0–2 الجزئية» (وثائق + OTP موحّد + هجرات + طبقة orders رفيعة + audit أولي للسحب).

**الهدف:** الانتقال من MVP متقدّم إلى منصة **مستقرة، قابلة للتوسع، جاهزة للإنتاج** دون إضافة ميزات كبيرة.  
**المبدأ:** لا حذف قبل التحقق 100٪، لا كسر للواجهات، كل مرحلة تُغلق قبل التالية.

---

## تم إنجازه في المستودع (هذا الدمج)

- [x] `docs/STABILIZATION-PLAN.md` — خطة تنفيذ + أولويات + مخاطر
- [x] `docs/legacy-inventory.md` — جرد `delivery_orders` / `food_orders` / `wallet-server` بأدلة
- [x] `docs/architecture.md`, `database-flow.md`, `order-lifecycle.md`, `wallet-system.md`, `deployment.md`, `production-readiness-checklist.md`
- [x] `shared/migration_ervenow_otp_challenges.sql` + `shared/migration_ervenow_audit_events.sql`
- [x] `shared/services/otpChallengeService.js` — memory (افتراضي) أو supabase + `invalidateOtpChallenge`
- [x] ربط OTP: `apps/core/routes.js`, `apps/driver/routes.js`, `apps/wallet/routes.js`
- [x] `shared/services/auditLog.js` + استدعاء عند إنشاء طلب سحب في `wallet/routes.js`
- [x] `shared/domain/orders/*` — طبقة دومين أولية
- [x] تعليق `shared/schema.sql` + تحذير `apps/finance/wallet-server.js`

**التفعيل الإنتاجي لـ OTP في DB:** نفّذ هجرة OTP ثم عيّن `ERVENOW_OTP_BACKEND=supabase` و`ERVENOW_OTP_PEPPER`.

**التفعيل لـ Audit:** نفّذ `migration_ervenow_audit_events.sql` (السجلات تُكتب بصمت إن لم يكن الجدول موجوداً).

---

## ترتيب الأولويات (ما نُنفّذ أولًا)

| # | المرحلة | الأولوية | السبب |
|---|---------|----------|--------|
| 1 | **توثيق + جرد Legacy** | P0 | يمنع حذفاً خاطئاً ويوحّد فهم الفريق |
| 2 | **OTP موحّد (Supabase)** | P0 | يمنع فقدان الجلسة عند إعادة التشغيل / تعدد النسخ |
| 3 | **Audit log (قاعدة)** | P0 | مطلوب للمالية والتدقيق والاسترداد |
| 4 | **طبقة Order Domain (رفيعة)** | P1 | تقليل تشتت `status` / `delivery_status` دون كسر API |
| 5 | **توحيد المحفظة (تصميم + ترحيل تدريجي)** | P1 | مخاطر مالية مزدوجة الدفاتر |
| 6 | **تعطيل/تأمين wallet-server** | P1 | سطح هجوم عالٍ إن وُضع علناً |
| 7 | **مراقبة وHealth** | P2 | بعد استقرار المسارات الحرجة |
| 8 | **Checklist إنتاج** | P2 | يُحدَّث مع كل إصدار |

---

## 1) إزالة بقايا النظام القديم — **حالة الجرد (مُحدَّثة من الكود)**

| الأصل | مستخدم في التطبيق (JS)؟ | قرار مرحلة 1 |
|--------|---------------------------|----------------|
| **`public.orders`** | نعم — كل التوصيل والكاشير | **مصدر الحقيقة للتشغيل** |
| **`public.delivery_orders`** | لا يوجد أي `from("delivery_orders")` في JS | **Legacy في SQL فقط** — لا حذف جدول؛ توثيق + هجرات تاريخية تبقى؛ اختياري لاحقاً: VIEW أو أرشفة بيانات |
| **`food_orders`** | نعم — `apps/food/routes.js` | **مستخدم** — لا حذف؛ عمود `delivery_order_id` يخزّن **uuid من `orders`** (اسم عمود تاريخي) |
| **`orders.delivery_order_id` (مالي)** | `finance/hooks.js` يبحث به عن صف `orders` | **Legacy link** — يبقى حتى إعادة تصميم التسوية |

**إجراء مرحلة 1 (آمن):** وثائق فقط + تعليقات في `shared/schema.sql` تشير إلى `docs/legacy-inventory.md`. **لا حذف جداول.**

---

## 2) توحيد حالات الطلب (`status` vs `delivery_status`)

| الحقل | الغرض الحالي | يحدّثه غالباً |
|--------|----------------|---------------|
| **`delivery_status`** | دورة التوصيل (draft → pending → accepted → … → delivered) | `apps/delivery/*`, `apps/driver/*`, `apps/order/*`, checkout |
| **`status`** | نموذج مالي قديم (`new`, `accepted`, `onroad`, `delivered`, `cancelled`) | `apps/finance/routes.js`, `onDeliveryDelivered` |

**الهندسة المقترحة (بدون كسر الواجهات):**

- **قصيرة المدى:** الإبقاء على العمودين؛ إضافة طبقة **`shared/domain/orders/`** تعرض:
  - `getEffectiveDeliveryStatus(row)`
  - `describeOrderState(row)` للتوثيق والـ logging
- **متوسطة المدى:** **Order State Facade** واحد يحدّث الحقلين معاً داخل معاملة DB (أو RPC) — يتطلب هجرة واختبارات.
- **طويلة المدى:** دمج في عمود واحد + view للتوافق.

**ملفات متأثرة لاحقاً:** `apps/delivery/service.js`, `apps/finance/routes.js`, `apps/finance/hooks.js`, `apps/checkout/service.js`, واجهات `public/*.html`.

---

## 3) OTP خارج الذاكرة

- **التنفيذ:** جدول `public.ervenow_otp_challenges` + `shared/services/otpChallengeService.js`.
- **التفعيل:** `ERVENOW_OTP_BACKEND=supabase` بعد تنفيذ `shared/migration_ervenow_otp_challenges.sql`.
- **الافتراضي:** `memory` — **صفر كسر** للبيئات الحالية.

**نطاقات (scopes):** `core_login`, `driver_login`, `wallet_withdraw` (قابلة للتوسيع).

---

## 4) Audit logging

- **التنفيذ:** `shared/migration_ervenow_audit_events.sql` + `shared/services/auditLog.js` (إدراج بسيط).
- **الربط التدريجي:** السحب، الموافقات، تغيير IBAN، إجراءات إدارية — لاحقاً مسار مسار.

---

## 5–6) المحفظة ومصدر الحقيقة المالي

**الوضع الحالي (من الكود):**

- **تشغيل:** `ervenow_wallets`, `ervenow_wallet_transactions`, `ervenow_withdraw_requests`, RPC مثل `ervenow_wallet_apply_driver_order_earning`.
- **محاسبة قديمة:** `wallets`, `wallet_transactions`, `erwenow_finance_settle_order`.
- **دفتر موحّد (اختياري):** RPC `ervenow_ledger_*` من `wallet/routes.js`.

**هدف مرحلة لاحقة:** وثيقة «مصدر حقيقة واحد» + خطة ترحيل؛ **لا إزالة جداول في هذه المرحلة.**

---

## 7) Order Domain Layer

- **المجلد:** `shared/domain/orders/` — ثوابت + حالة فعّالة + إعادة تصدير انتقالات آمنة.
- **التوسع:** نقل منطق من `delivery/service.js` تدريجياً خلف واجهة الدومين.

---

## 8) الوثائق

تم إنشاء: `architecture.md`, `database-flow.md`, `order-lifecycle.md`, `wallet-system.md`, `deployment.md`, `production-readiness-checklist.md`, `legacy-inventory.md`.

---

## 9–10) مراقبة و Checklist

راجع `docs/production-readiness-checklist.md` و`docs/deployment.md`.

---

## الملفات المتأثرة (حسب المرحلة)

| المرحلة | ملفات |
|----------|--------|
| OTP | `apps/core/routes.js`, `apps/driver/routes.js`, `apps/wallet/routes.js`, `shared/services/otpChallengeService.js` |
| Audit | `apps/wallet/routes.js` (سحب)، لاحقاً: `apps/admin/*`, تغييرات IBAN، … + `auditLog.js` |
| Domain | `shared/domain/orders/*`, ثم استهلاك من `delivery/service.js` |
| Legacy docs | `shared/schema.sql` (تعليق رأسي فقط)، `docs/legacy-inventory.md` |

---

## Migrations مطلوبة (جديدة)

1. `shared/migration_ervenow_otp_challenges.sql` — قبل `ERVENOW_OTP_BACKEND=supabase`.
2. `shared/migration_ervenow_audit_events.sql` — قبل استخدام `auditLog.js` في المسارات.

---

## المخاطر

| خطر | تخفيف |
|------|--------|
| تفعيل Supabase OTP قبل الهجرة | 503/رسالة واضحة؛ الافتراضي memory |
| ازدواجية محفظة | لا دمج عاجل؛ توثيق ثم خطة ترحيل |
| تغيير سلوك OTP | اختبار يدوي لكل مسار send/verify |
