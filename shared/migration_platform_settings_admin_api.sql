-- =============================================================================
-- إعدادات المنصة — نموذج موسّع (id UUID، key، value، type، description)
-- نفّذ في Supabase SQL Editor.
--
-- يدعم الترقية من الهيكل القديم (مفتاح key كـ PRIMARY KEY فقط) دون حذف بيانات.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  type TEXT DEFAULT 'string',
  description TEXT,
  updated_at TIMESTAMP DEFAULT now()
);

-- ترقية: جدول قديم بدون عمود id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'platform_settings'
      AND c.column_name = 'key'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'platform_settings'
      AND c.column_name = 'id'
  ) THEN
    ALTER TABLE public.platform_settings ADD COLUMN id UUID DEFAULT gen_random_uuid();
    UPDATE public.platform_settings SET id = gen_random_uuid() WHERE id IS NULL;
    ALTER TABLE public.platform_settings ALTER COLUMN id SET NOT NULL;
    ALTER TABLE public.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_pkey;
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);
    ALTER TABLE public.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_key_key;
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_key_key UNIQUE (key);
    ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'string';
    ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE public.platform_settings ALTER COLUMN value DROP NOT NULL;
  ELSE
    ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'string';
    ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS description TEXT;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
