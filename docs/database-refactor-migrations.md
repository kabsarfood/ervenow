# ERVENOW — Database Refactor (Supabase)

تنفيذ تدريجي وآمن — **بدون حذف جداول**.

## ترتيب التنفيذ (إلزامي)

**إن لم تكن جداول Ledger موجودة بعد:** نفّذ أولاً:

`shared/migration_bootstrap_ledger_finance.sql` (ملف واحد — جداول + RPC + بذرة محافظ)

**توحيد السحب (جدول + VIEW):** نفّذ:

`shared/migration_withdraw_ledger_only_final.sql` (مرة واحدة — `ervenow_withdraw_requests` + VIEW `withdraw_requests`)

ثم (اختياري للمراحل اللاحقة):


| # | ملف | المرحلة |
|---|-----|---------|
| 1 | `shared/migration_database_refactor_01_ledger_canonical.sql` | Ledger مصدر وحيد + فهرس `reference_id` |
| 2 | `shared/migration_database_refactor_02_withdraw_unify.sql` | توحيد السحب على `ervenow_withdraw_requests` |
| 3 | `shared/migration_database_refactor_03_drivers_user_id.sql` | `drivers.user_id` → `users` |
| 4 | `shared/migration_database_refactor_04_orders_legacy_comments.sql` | توثيق Legacy |
| 5 | `shared/migration_database_refactor_05_settlement_log.sql` | `settlement_log` + RPC |
| 6 | `shared/migration_database_refactor_06_audit_performance.sql` | فهرس audit |
| 7 | `shared/migration_database_refactor_07_performance_indexes.sql` | فهارس orders / ledger |
| 8 | `shared/migration_database_refactor_08_legacy_comments.sql` | تعليقات Legacy |
| 9 | `shared/migration_database_refactor_09_ledger_only_block_legacy.sql` | منع INSERT/UPDATE على الجداول المالية القديمة |

بعد كل دفعة: تحقق من `NOTIFY pgrst` أو أعد تحميل schema cache في Supabase.

## ما يتغير

- **مالي:** `ervenow_ledger_wallets` + `ervenow_ledger_transactions` = CANONICAL (مع `idx_ledger_unique_ref`).
- **سحب:** إدراج/موافقة عبر `ervenow_withdraw_requests`؛ VIEW `withdraw_requests` للتوافق إن وُجدت أرشفة الجدول القديم.
- **مندوب:** عمود `drivers.user_id` مربوط بالهاتف.
- **تسوية:** `settlement_log` + `settlement_log_try_claim` + `shared/services/settlementGuard.js` في Node.

## التحقق بعد التنفيذ

```sql
-- فهرس ledger
SELECT indexname FROM pg_indexes
WHERE tablename = 'ervenow_ledger_transactions' AND indexname = 'idx_ledger_unique_ref';

-- VIEW سحب (اختياري)
SELECT table_type FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'withdraw_requests';

-- ربط مندوبين
SELECT count(*) AS linked FROM drivers WHERE user_id IS NOT NULL;

-- settlement_log
SELECT count(*) FROM settlement_log;
```

## Ledger Only Mode (Node)

```env
FINANCE_MODE=ledger_only
```

- Guard: `shared/utils/financeMode.js` (`isLedgerOnlyMode`, `assertLedgerOnlyFinance`)
- تسوية: `shared/services/ledgerOnlySettlement.js` → `ervenow_ledger_settle_*`
- رصيد/حركات: `shared/utils/ledgerWallet.js` — لا fallback `legacy_operational`
- بعد Phase 9: أي INSERT على `wallets` / `driver_wallets` / … يفشل من قاعدة البيانات

## Node

بعد Phase 5، أعد تشغيل الخادم. المسارات تستخدم `tryClaimSettlement` قبل:

- `shadowLedgerSettleDeliveredOrder`
- `driver_ledger_apply_commission_on_delivered`
- `ervenow_wallet_apply_driver_order_earning`
- `erwenow_finance_settle_order`

## تعريف النجاح

- لا تكرار لنفس `settlement_kind` على نفس `entity_id`.
- كل حركة ledger مكتملة لها `reference_id` فريد per `wallet_id`.
- السحب الجديد في `ervenow_withdraw_requests` فقط (VIEW للقراءة/إدراج القديم).

## لاحقاً (خارج هذا PR)

- إيقاف كتابة `wallets` / `ervenow_wallet_transactions` تدريجياً.
- قراءة الرصيد من ledger فقط في لوحة الأدمن.
