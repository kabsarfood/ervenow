-- =============================================================================
-- placement — مكان عرض البنر (مستقل لكل صفحة/قسم، قابل للتوسع)
--   npm run migrate:hero-banners-placement
-- =============================================================================

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS placement text;

UPDATE public.hero_banners
SET placement = CASE
  WHEN banner_kind = 'platform' THEN 'guest_dashboard'
  WHEN banner_kind = 'promo' THEN 'home_promo'
  ELSE 'home_promo'
END
WHERE placement IS NULL OR trim(placement) = '';

ALTER TABLE public.hero_banners
  ALTER COLUMN placement SET DEFAULT 'home_promo';

UPDATE public.hero_banners
SET placement = 'home_promo'
WHERE placement IS NULL OR trim(placement) = '';

ALTER TABLE public.hero_banners
  ALTER COLUMN placement SET NOT NULL;

ALTER TABLE public.hero_banners
  DROP CONSTRAINT IF EXISTS hero_banners_placement_check;

ALTER TABLE public.hero_banners
  ADD CONSTRAINT hero_banners_placement_check
  CHECK (placement IN (
    'home_promo',
    'home_hero',
    'guest_dashboard',
    'delivery',
    'driver_app',
    'store_dashboard'
  ));

CREATE INDEX IF NOT EXISTS idx_hero_banners_placement_active_sort
  ON public.hero_banners (placement, is_active, sort_order);

COMMENT ON COLUMN public.hero_banners.placement IS 'مكان العرض: home_promo | home_hero | guest_dashboard | delivery | driver_app | store_dashboard';

NOTIFY pgrst, 'reload schema';
