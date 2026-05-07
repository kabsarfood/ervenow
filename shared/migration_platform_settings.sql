-- ERVENOW: إعدادات الهوية البصرية (شعار + ألوان) — key/value
-- نفّذ في Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_settings_updated_idx ON public.platform_settings (updated_at DESC);

COMMENT ON TABLE public.platform_settings IS 'إعدادات المنصة العامة — مفاتيح مثل logo_url و primary_color';

INSERT INTO public.platform_settings (key, value)
VALUES
  ('logo_url', ''),
  ('primary_color', '#5b371d'),
  ('secondary_color', '#8b5e34'),
  ('accent_color', '#d4a76a'),
  ('background_color', '#f8f5f0'),
  ('text_color', '#2b1f16')
ON CONFLICT (key) DO NOTHING;
