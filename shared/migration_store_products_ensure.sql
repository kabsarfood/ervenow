-- =============================================================================
-- ضمان وجود public.store_products
-- يصلح: ERROR: relation "public.store_products" does not exist
-- نفّذ في Supabase → SQL Editor بعد وجود جدول public.stores
-- لا يغيّر كود التطبيق — هجرة قاعدة فقط.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,

  name text NOT NULL,
  description text,

  price numeric NOT NULL DEFAULT 0,

  image_url text,
  images jsonb,

  offer_price numeric,

  active boolean DEFAULT true,
  sort_order int DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- إن وُجد الجدول من نسخة قديمة بلا images / offer_price
ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS images jsonb;
ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS offer_price numeric;

CREATE INDEX IF NOT EXISTS idx_store_products_store ON public.store_products (store_id);

CREATE INDEX IF NOT EXISTS idx_store_products_active ON public.store_products (store_id, active);

COMMENT ON TABLE public.store_products IS 'منتجات المتاجر المعتمدة — لوحة التاجر';

NOTIFY pgrst, 'reload schema';
