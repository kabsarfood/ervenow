-- مشاهدات صفحة المتجر العامة (store.html)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS profile_views bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.stores.profile_views IS 'عدد فتح صفحة المتجر العامة للزوار';
