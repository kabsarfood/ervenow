-- =============================================================================
-- تتبع استخدام التصنيفات (Smart ordering) — نفّذ في Supabase بعد migration_categories.sql
-- =============================================================================

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

COMMENT ON COLUMN public.categories.usage_count IS 'عدد مرات «استخدام» التصنيف (موافقة متجر، منتج، إلخ) لترتيب القوائم ديناميكياً';
COMMENT ON COLUMN public.categories.last_used_at IS 'آخر وقت زاد فيه usage_count';

CREATE INDEX IF NOT EXISTS idx_categories_type_scope_usage
  ON public.categories (type, scope, is_active, usage_count DESC);

NOTIFY pgrst, 'reload schema';
