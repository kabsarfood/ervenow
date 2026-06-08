-- =============================================================================
-- تمييز بنر المناسبات/العروض عن بنر الزائر والمستخدم
--   promo    = شريط الغلافات في أعلى الصفحة الرئيسية (مناسبات وعروض)
--   platform = بطاقة رسالة الزائر/المستخدم (ما يلزمهم من المنصة)
--
--   npm run migrate:hero-banners-kind
-- =============================================================================

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS banner_kind text NOT NULL DEFAULT 'promo';

UPDATE public.hero_banners
SET banner_kind = 'promo'
WHERE banner_kind IS NULL OR trim(banner_kind) = '';

ALTER TABLE public.hero_banners
  DROP CONSTRAINT IF EXISTS hero_banners_kind_check;

ALTER TABLE public.hero_banners
  ADD CONSTRAINT hero_banners_kind_check
  CHECK (banner_kind IN ('promo', 'platform'));

CREATE INDEX IF NOT EXISTS idx_hero_banners_kind_active_sort
  ON public.hero_banners (banner_kind, is_active, sort_order);

COMMENT ON COLUMN public.hero_banners.banner_kind IS 'promo=مناسبات/عروض (شريط أعلى الرئيسية) | platform=زائر/مستخدم المنصة';

NOTIFY pgrst, 'reload schema';
