-- =============================================================================
-- ERVENOW — أعمدة orders الاختيارية (idempotent) لإصلاح أخطاء PostgREST مثل:
--   «Could not find the 'payment_status' column of 'orders' in the schema cache»
-- نفّذ في Supabase → SQL Editor بعد migration_orders_unify_delivery.sql
-- =============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS store_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS store_address text;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS breakdown jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS data jsonb;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS merchant_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_provider_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_order_id uuid;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS currency_code text;

COMMENT ON COLUMN public.orders.payment_status IS
  'حالة الدفع: pending | paid | failed — قيم متوافقة: paid, captured, completed, unpaid';
COMMENT ON COLUMN public.orders.payment_method IS
  'وسيلة الدفع عند التفعيل: mada | stcpay | cash';

NOTIFY pgrst, 'reload schema';
