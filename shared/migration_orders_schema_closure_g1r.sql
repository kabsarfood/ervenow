-- =============================================================================
-- ERVENOW G1-R — إغلاق schema جدول orders (7 أعمدة ناقصة)
-- نفّذ في Supabase SQL Editor بعد migration_orders_schema_cache_columns.sql
-- =============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS platform_commission numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rated_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_location text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_name text;

CREATE INDEX IF NOT EXISTS orders_delivered_at_idx ON public.orders (delivered_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS orders_scheduled_at_idx ON public.orders (scheduled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS orders_rated_at_idx ON public.orders (rated_at DESC NULLS LAST);

COMMENT ON COLUMN public.orders.delivered_at IS 'وقت التسليم الفعلي';
COMMENT ON COLUMN public.orders.rated_at IS 'وقت تقييم العميل للطلب';

NOTIFY pgrst, 'reload schema';
