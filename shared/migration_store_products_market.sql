-- =============================================================================
-- حقول السوبرماركت لجدول store_products (تصنيف، مخزون، تقييم عرض)
-- نفّذ في Supabase → SQL Editor بعد migration_store_products_ensure.sql
-- offer_price قد يكون مضافاً مسبقاً من migration_store_withdrawals.sql
-- =============================================================================

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS stock integer;

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS rating numeric(3, 2);

COMMENT ON COLUMN public.store_products.category IS 'قسم المنتج: vegetables, meat, dairy, …';
COMMENT ON COLUMN public.store_products.stock IS 'المخزون؛ NULL = بدون حد صريح';
COMMENT ON COLUMN public.store_products.rating IS 'تقييم عرض المنتج (0–5) يدوي أو لاحقاً من العملاء';

CREATE INDEX IF NOT EXISTS idx_store_products_store_category ON public.store_products (store_id, category)
WHERE
  active = true;

NOTIFY pgrst, 'reload schema';
