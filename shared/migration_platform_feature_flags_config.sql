-- =============================================================================
-- Feature flags — حقل config (JSON) لـ auto_freeze thresholds
-- يتطلب: migration_platform_feature_flags.sql
-- =============================================================================

ALTER TABLE public.platform_feature_flags
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.platform_feature_flags.config IS 'إعدادات الميزة — مثال auto_freeze: warn_threshold, freeze_threshold';

UPDATE public.platform_feature_flags
SET config = jsonb_build_object('warn_threshold', 50, 'freeze_threshold', 100)
WHERE key = 'auto_freeze'
  AND (config IS NULL OR config = '{}'::jsonb);

NOTIFY pgrst, 'reload schema';
