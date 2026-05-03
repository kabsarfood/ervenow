-- =============================================================================
-- إكمال نظام المتاجر: منتجات، تقييمات، حقول ترتيب وشعار
-- نفّذ في Supabase → SQL Editor بعد migration_stores.sql
-- =============================================================================

-- توسيع أنواع المتاجر (يشمل "غيره")
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_type_check;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_type_check CHECK (
    type IN (
      'restaurant',
      'pharmacy',
      'supermarket',
      'minimarket',
      'vegetables',
      'butcher',
      'fish',
      'home_business',
      'services',
      'other'
    )
  );

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS location_text text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS average_rating numeric NOT NULL DEFAULT 0;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS rating_count int NOT NULL DEFAULT 0;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS total_orders int NOT NULL DEFAULT 0;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS stores_owner_user_idx ON public.stores (owner_user_id);
CREATE INDEX IF NOT EXISTS stores_rating_orders_idx ON public.stores (average_rating DESC, total_orders DESC);

-- منتجات المتجر
CREATE TABLE IF NOT EXISTS public.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  image_url text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_products_store_active_idx ON public.store_products (store_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS store_products_store_created_idx ON public.store_products (store_id, created_at DESC);

-- تقييمات المتجر
CREATE TABLE IF NOT EXISTS public.store_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  rating int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_reviews_store_idx ON public.store_reviews (store_id, created_at DESC);

COMMENT ON TABLE public.store_products IS 'منتجات المتاجر المعتمدة — لوحة التاجر';
COMMENT ON TABLE public.store_reviews IS 'تقييمات العملاء للمتاجر';
