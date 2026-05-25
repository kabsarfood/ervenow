# ERVENOW — Database flow

## 1. مخطط أولي وتراكم هجرات

- المخطط المرجعي: `shared/schema.sql` (نقطة بداية تثبيت جديدة).
- التعديلات اللاحقة: ملفات `shared/migration_*.sql` — **ترتيب التنفيذ** يجب توثيقه في بيئة كل فريق (لا يوجد migrator واحد مدمج في Node حالياً).

## 2. كيانات الطلب

### `public.orders` (مصدر حقيقة التشغيل)

- يحتوي أعمدة التوصيل بعد `migration_orders_unify_delivery.sql` (`delivery_status`, إحداثيات، أجور، `order_number`, `external_order_id`, …).
- يُنشأ عبر: `insertDeliveryOrderWithRetry` في `apps/delivery/service.js`، ومسارات `checkout`، و`POST /api/delivery/orders`، و`POST /api/food/orders` (فرع التوصيل).

### `public.delivery_orders`

- موجود في `schema.sql` وهجرات تاريخية.
- **لا يُقرأ أو يُكتب** من تطبيق Node الحالي — انظر `docs/legacy-inventory.md`.

### `public.food_orders`

- يستخدمه `apps/food/routes.js`.
- يربط اختيارياً بطلب توصيل عبر `delivery_order_id` (قيمة UUID من **`orders.id`** في المسار الحالي).

## 3. المستخدمون والمندوبون والمتاجر

- `users` — هوية المنصة، أدوار، حالة، وربما `iban` / `payout_iban_fingerprint` (مسار تاجر).
- `drivers` — ملف تعريف مندوب، بيانات بنكية مشفّرة (`bank_iban`)، `iqama_digits` فريد شرطي.
- `stores` — تسجيل متجر، محفظة متجر، سحوبات.

## 4. OTP و Audit (تثبيت)

- `ervenow_otp_challenges` — تحديات OTP قصيرة العمر (بعد `migration_ervenow_otp_challenges.sql`).
- `ervenow_audit_events` — سجل تدقيق append-only (بعد `migration_ervenow_audit_events.sql`).

## 5. محافظ متعددة الأجيال

راجع `docs/wallet-system.md` — يوجد أكثر من مسار (`ervenow_*`، `wallets`، `ervenow_ledger_*`)؛ التثبيت يتطلب سياسة «مصدر حقيقة» تدريجياً.

**هجرات التوحيد (تدريجي):** `docs/database-refactor-migrations.md` — ملفات `shared/migration_database_refactor_01..08_*.sql`.

## 6. Realtime

- التعليقات في `schema.sql` تشير إلى تفعيل Realtime لجداول معينة — يُحدَّث حسب المنتج الفعلي.
