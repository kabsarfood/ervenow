-- =============================================================================
-- ERVENOW Banner Management V2
--   npm run migrate:hero-banners-v2
-- =============================================================================

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS banner_targets jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 10;

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS banner_type text NOT NULL DEFAULT 'promotional';

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS display_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS impression_count bigint NOT NULL DEFAULT 0;

ALTER TABLE public.hero_banners
  ADD COLUMN IF NOT EXISTS click_count bigint NOT NULL DEFAULT 0;

UPDATE public.hero_banners
SET banner_targets = CASE
  WHEN placement = 'guest_dashboard' THEN '["visitor_dashboard"]'::jsonb
  WHEN placement = 'home_hero' THEN '["home"]'::jsonb
  WHEN placement = 'home_promo' THEN '["home"]'::jsonb
  WHEN banner_kind = 'platform' THEN '["visitor_dashboard"]'::jsonb
  ELSE '["home"]'::jsonb
END
WHERE banner_targets IS NULL OR banner_targets = '[]'::jsonb;

UPDATE public.hero_banners
SET display_mode = CASE
  WHEN placement = 'home_promo' THEN 'carousel'
  WHEN placement = 'home_hero' THEN 'card'
  ELSE COALESCE(NULLIF(display_mode, ''), 'auto')
END
WHERE display_mode IS NULL OR display_mode = 'auto';

UPDATE public.hero_banners
SET status = CASE
  WHEN is_active = false THEN 'paused'
  WHEN starts_at IS NOT NULL AND starts_at > now() THEN 'scheduled'
  ELSE 'active'
END
WHERE status IS NULL OR status = '';

ALTER TABLE public.hero_banners
  DROP CONSTRAINT IF EXISTS hero_banners_status_check;

ALTER TABLE public.hero_banners
  ADD CONSTRAINT hero_banners_status_check
  CHECK (status IN ('active', 'paused', 'scheduled'));

ALTER TABLE public.hero_banners
  DROP CONSTRAINT IF EXISTS hero_banners_type_check;

ALTER TABLE public.hero_banners
  ADD CONSTRAINT hero_banners_type_check
  CHECK (banner_type IN ('promotional', 'awareness', 'operational', 'alert'));

ALTER TABLE public.hero_banners
  DROP CONSTRAINT IF EXISTS hero_banners_display_mode_check;

ALTER TABLE public.hero_banners
  ADD CONSTRAINT hero_banners_display_mode_check
  CHECK (display_mode IN ('auto', 'carousel', 'card', 'strip'));

CREATE INDEX IF NOT EXISTS idx_hero_banners_targets_gin
  ON public.hero_banners USING gin (banner_targets);

CREATE INDEX IF NOT EXISTS idx_hero_banners_priority
  ON public.hero_banners (priority, sort_order);

COMMENT ON COLUMN public.hero_banners.banner_targets IS 'JSON array of target ids — home, visitor_dashboard, driver_dashboard, …';

NOTIFY pgrst, 'reload schema';
