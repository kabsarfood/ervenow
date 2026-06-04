# Store Account Migration — Execution Report

> تقرير تنفيذ المراحل 1–4 (كود). مرحلة 5 SQL جاهزة للتشغيل اليدوي على Supabase.

## القرار

- أدوار رسمية: **Customer · Store · Driver · Admin**
- `users.role`: **`store`** (مع alias مؤقت `merchant` | `restaurant`)
- **`stores.type = restaurant`** — بدون تغيير

## الملفات المضافة

| ملف | الغرض |
|-----|--------|
| `shared/middleware/storeRole.js` | `requireStoreRole`, `isStoreAccountRole` |
| `shared/utils/storeAccountRole.js` | re-export للمساعدة |
| `tests/unit/storeRoleMiddleware.test.js` | اختبارات الدور |
| `shared/migration_users_role_store_account.sql` | تحويل يدوي لـ `users.role` (مرحلة 5) |

## الملفات المعدّلة (ملخص)

### Backend

- `shared/middleware/auth.js`
- `apps/core/routes.js`
- `shared/utils/loginDestinations.js`
- `apps/wallet/routes.js`
- `apps/notifications/routes.js`
- `apps/store/routes.js`
- `apps/store/deliveryEngineRoutes.js`
- `apps/food/routes.js`
- `apps/finance/routes.js`
- `apps/finance/walletService.js`
- `apps/admin/routes.js`
- `shared/services/unifiedOrderStatus.js`
- `shared/services/registrationApprovals.js`
- `shared/lib/trackingSocket.js`
- `shared/messages/storeWhatsApp.js`

### Frontend (`public/` — يُفضَّل مزامنة `ervenow-frontend/`)

- `login.html`
- `assets/account-destinations.js`
- `assets/store-shell.js`
- `assets/guest-shell.js`
- `assets/cart.js`
- `store-dashboard.html`
- `merchant-dashboard.html`
- `register-store.html`
- `partner-portal.html`

## ما لم يُمس (حسب القيود)

- Ledger SQL / `storeMerchantLedgerCredit` مراجع `merchant`
- Wallet schema
- Delivery Engine business logic
- Financial Hardening
- حذف `merchant` / `restaurant` من الكود

## مرحلة 5 — كبسار

نفّذ في Supabase:

```sql
-- من shared/migration_users_role_store_account.sql
UPDATE public.users SET role = 'store', updated_at = now()
WHERE lower(trim(role)) IN ('merchant', 'restaurant');
```

ثم **إعادة تسجيل الدخول** (`?role=store`) لتجديد JWT.

## نتائج الاختبارات (محلي)

| اختبار | النتيجة |
|--------|---------|
| `tests/unit/storeRoleMiddleware.test.js` | **3/3 pass** |
| `tests/unit/restaurantBrowseVisibility.test.js` | **3/3 pass** |
| `tests/unit/merchantDepositFlow.test.js` | فشل تحميل — `jest` غير معرّف (اختبار قديم، لم يُعدَّل) |
| `tests/unit/storeMerchantLedgerCredit.test.js` | نفس السبب |

## كبسار كـ Store Account

| خطوة | الحالة |
|------|--------|
| دخول `?role=store` + alias `merchant`/`restaurant` | ✅ في الكود |
| لوحة متجر / منتجات / سحوبات / Delivery Engine API | ✅ `requireStoreRole` |
| تحويل `users.role` في DB | ⏳ نفّذ `shared/migration_users_role_store_account.sql` ثم أعد الدخول |
| اختبار يدوي ERVENOW PAY / Finance | ⏳ بعد تحويل DB وإعادة JWT |

## جاهزية إزالة legacy

| البند | الحالة |
|-------|--------|
| Alias في middleware | ✅ |
| Ledger | لم يُغيَّر — جاهز مسبقاً لـ `store` |
| حذف merchant/restaurant من الكود | ⏳ تقرير نجاح مستقل بعد SQL + smoke يدوي |
