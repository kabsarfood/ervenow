-- =============================================================================
-- لوحة التاجر: بيانات بروفايل إضافية لكل متجر (مرجع واحد في Supabase لكل store)
-- نفّذ في Supabase → SQL Editor بعد migration_stores.sql و store_marketplace
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.store_merchant_hub (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  bio text,
  banner_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_merchant_hub_updated_idx ON public.store_merchant_hub (updated_at DESC);

COMMENT ON TABLE public.store_merchant_hub IS 'بروفايل التاجر في لوحة المتجر — صورة غلاف، نبذة، إلخ';
