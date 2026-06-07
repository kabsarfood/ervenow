-- =============================================================================
-- بنرات الصفحة الرئيسية (Hero Banner) — إدارة من لوحة الإدارة
-- نفّذ في Supabase → SQL Editor، أو من الطرفية:
--   npm run migrate:hero-banners
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.hero_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  button1_text text,
  button1_url text,
  button2_text text,
  button2_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hero_banners_active_sort
  ON public.hero_banners (is_active, sort_order);

COMMENT ON TABLE public.hero_banners IS 'بنرات الصفحة الرئيسية — يُعرض أول بنر نشط حسب الترتيب والجدولة';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hero_banners TO service_role;

NOTIFY pgrst, 'reload schema';
