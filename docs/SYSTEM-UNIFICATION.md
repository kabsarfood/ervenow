# ERVENOW — System Unification Refactor

## الحالة الحالية (Node)

| مجال | SoT |
|------|-----|
| **كل الطلبات** | `orders` — Food + Delivery + Services |
| **نوع الطلب** | `orders.order_type` (`delivery`, `store`, `restaurant`, `service`, `gas_delivery`) |
| **حالة الطلب** | `orders.delivery_status` فقط — `shared/domain/orders/orderStatus.js` |
| **تحديث الحالة** | `PATCH /api/order/:id/status` — `shared/services/unifiedOrderStatus.js` |
| **إنشاء طلب** | `POST /api/order/create` (سلة = `items[]`، توصيل = بدون items، خدمة = `order_type: service`) |
| **مالية** | `FINANCE_MODE=ledger_only` + `ervenow_ledger_*` |
| **تسوية الخدمات** | `ervenow_ledger_settle_service_booking` — يقرأ `orders` حيث `order_type IN ('service','gas_delivery')` |

## service_bookings → orders

- SQL: `shared/migration_unification_11_smart_service_bookings_to_orders.sql`
- **إصلاح فشل جزئي:** `shared/migration_unification_12_repair_service_bookings_merge.sql`
- **قفل نهائي (rename + triggers):** `shared/migration_unification_13_finalize_service_bookings_lock.sql`
- تشخيص قبل التنفيذ: `shared/diagnose_service_bookings_before_migration.sql`
- من الطرفية (مع `.env`): `node scripts/diagnose-service-bookings.js`
- إنشاء الخدمات: `shared/services/serviceOrderCreate.js` → `orders` فقط
- استعلامات الخدمات: `shared/utils/serviceOrderQuery.js`
- `service_bookings` أُعيد تسميته إلى `service_bookings_legacy` + trigger منع الكتابة (بعد تنفيذ الهجرة)

## مسارات مُهمَلة (Deprecation headers)

| مسار قديم | البديل |
|-----------|--------|
| `POST /api/delivery/orders` | `POST /api/order/create` |
| `POST /api/checkout` | `POST /api/order/create` مع `items` |
| `POST /api/services/home-order` | `POST /api/order/create` مع `order_type: service` |
| `PATCH /api/delivery/orders/:id/status` | `PATCH /api/order/:id/status` |
| `PATCH /api/finance/orders/:id/status` | `PATCH /api/order/:id/status` |
| `POST /api/driver/complete-order/:id` | `PATCH /api/order/:id/status` → `delivered` |
| `POST /api/driver/start-delivery/:id` | `PATCH /api/order/:id/status` → `delivering` |

## مرحلة 7 (لاحقاً — DB)

- أرشفة: `delivery_orders`, `wallets` بعد ترحيل البيانات.
