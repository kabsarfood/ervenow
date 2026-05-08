# ERVENOW — Wallet system

## 1. ملخص تنفيذي

اليوم توجد **أكثر من طبقة مالية** في الكود والهجرات. من الضروري التمييز بين **محفظة التشغيل** (مندوب/سحب/استرجاع عميل) و**دفتر المحاسبة** القديم.

## 2. محفظة التشغيل (الواجهة الرئيسية للمندوب/التاجر)

| الجدول | الغرض |
|--------|--------|
| `ervenow_wallets` | رصيد تجميعي لكل `user_id` |
| `ervenow_wallet_transactions` | حركات `earning` / `withdraw` مع `status` |
| `ervenow_withdraw_requests` | طلبات سحب مع `iban` نصي (مسار يحتاج تثبيت أمني لاحقاً) |

**API:** `GET/POST /api/wallet/*` في `apps/wallet/routes.js`.  
**RPC أمثلة:** `ervenow_wallet_apply_driver_order_earning`, `ervenow_wallet_withdraw_atomic`, `ervenow_wallet_operational_summary`.

## 3. دفتر المحاسبة (Finance MVP)

| الجدول | الغرض |
|--------|--------|
| `wallets` | أرصدة لأصحاب المصلحة |
| `wallet_transactions` | حركات دائن/مدين |
| `withdrawals` (قديم) | سحوبات مرتبطة بـ `wallet_id` |

**API:** `apps/finance/routes.js`, `apps/finance/walletService.js`.  
**تسوية عند التسليم:** `erwenow_finance_settle_order` عبر `onDeliveryDelivered`.

## 4. دفتر `ervenow_ledger_*` (موحّد اختياري)

- يُستدعى من مسارات admin/ledger في `apps/wallet/routes.js` عند توفر RPC بعد `migration_unified_finance_ledger.sql`.
- قد يتعايش أو يتعارض مع المسارين أعلاه إن لم تُحدَّد سياسة منتج.

## 5. محفظة المتجر

- `store_wallets`, `store_transactions`, `store_withdrawals` — مسارات `apps/store/routes.js` وموافقة إدارية.

## 6. مصدر الحقيقة المستهدف (Financial Source of Truth)

**الهدف الاستراتيجي (لم يُنفَّذ بالكامل):** مصدر واحد للأرصدة والتسويات مع:

- عمليات ذرية (RPC / transactions)
- تدقيق (`ervenow_audit_events`)
- تقارير مطابقة (reconciliation)

**المرحلة الحالية:** توثيق + عدم حذف جداول؛ أي دمج يتطلب خطة ترحيل واختبارات مالية.

## 7. تحذير أمني

- `apps/finance/wallet-server.js` — مسارات بدون مصادقة؛ لا يُنشر على الإنترنت.
