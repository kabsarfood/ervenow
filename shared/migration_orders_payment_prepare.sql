-- =============================================================================
-- تجهيز الدفع على جدول orders (بدون تفعيل بوابة خارجية)
-- نفّذ في Supabase → SQL Editor
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_method text;

COMMENT ON COLUMN public.orders.payment_status IS
  'حالة الدفع: pending | paid | failed — قيم متوافقة مع القديم: paid, captured, completed, unpaid';

COMMENT ON COLUMN public.orders.payment_method IS
  'وسيلة الدفع عند التفعيل: mada | stcpay | cash';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_method_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payment_method_check
      CHECK (
        payment_method IS NULL
        OR lower(trim(payment_method)) IN ('mada', 'stcpay', 'cash')
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
