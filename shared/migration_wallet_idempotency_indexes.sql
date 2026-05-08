-- =============================================================================
-- حماية إيداع الأرباح من التكرار (فهارس فقط — لا تعديل أعمدة ولا حذف بيانات)
-- نفّذ في Supabase → SQL Editor بعد:
--   - migration_ervenow_wallet_atomic_v2.sql (عمود status على ervenow_wallet_transactions)
--   - migration_store_wallet.sql (جدول store_transactions)
--
-- ملاحظة: إن كان لديك مسبقاً الفهرس uq_ervenow_wallet_tx_earning_per_order من
-- migration_wallet_operational_ledger.sql فهو يغطي منطقاً مشابهاً؛ يمكن الإبقاء
-- على الفهرسين أو إسقاط الأقدم لاحقاً لتجنب التكرار الوظيفي.
-- =============================================================================

-- 1) مندوب — منع أكثر من حركة earning مكتملة لنفس الطلب (reference_id = معرف الطلب)
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_earning_per_order
  ON public.ervenow_wallet_transactions (reference_id)
  WHERE type = 'earning' AND status = 'completed';

-- 2) متجر — منع أكثر من حركة earning لنفس الطلب
-- الإيداع الحالي في store_wallet_credit_for_order يستخدم type = 'credit'؛
-- يبقى الفهرس العام idx_store_transactions_unique_order على (order_id) إن وُجد.
-- هذا الفهرس يحمي التسمية earning عند اعتمادها لاحقاً أو لمسارات أخرى.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_earning_per_order
  ON public.store_transactions (order_id)
  WHERE type = 'earning';

-- 3) متجر — منع تكرار إيداع credit لنفس الطلب (idempotency مع store_wallet_credit_for_order)
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_credit_per_order
  ON public.store_transactions (order_id)
  WHERE type = 'credit';

NOTIFY pgrst, 'reload schema';
