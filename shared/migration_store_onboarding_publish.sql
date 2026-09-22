-- رحلة الانضمام: رخصة + طلب استكمال + نشر مستقل عن الاعتماد.
-- المتاجر المعتمدة الظاهرة حالياً تُعلَّم published حتى لا تختفي من القوائم.

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS publication_status text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS license_number text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS license_file_url text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS needs_info_message text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS needs_info_at timestamptz;

COMMENT ON COLUMN public.stores.publication_status IS 'draft | published | paused — ظهور الصفحة للعملاء، مستقل عن status';
COMMENT ON COLUMN public.stores.license_number IS 'رقم الرخصة إن وُجد';
COMMENT ON COLUMN public.stores.license_file_url IS 'صورة الرخصة في Storage';
COMMENT ON COLUMN public.stores.needs_info_message IS 'ما طلبه الأدمن لاستكمال بيانات طلب الانضمام';

UPDATE public.stores
SET publication_status = 'published'
WHERE publication_status IS NULL
  AND lower(coalesce(status, '')) = 'approved'
  AND (is_active IS NULL OR is_active = true);

UPDATE public.stores
SET publication_status = 'draft'
WHERE publication_status IS NULL;
