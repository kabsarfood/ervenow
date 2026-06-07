-- =============================================================================
-- رابط موقع المتجر الرسمي (Google Maps) — للخريطة والطلبات والمناديب
-- نفّذ في Supabase → SQL Editor
-- =============================================================================

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS maps_url text;

COMMENT ON COLUMN public.stores.maps_url IS 'رابط Google Maps المعتمد لموقع المتجر — يُستخدم في الخريطة والاستلام';

UPDATE public.stores
SET maps_url = 'https://www.google.com/maps?q=' || lat::text || ',' || lng::text
WHERE maps_url IS NULL
  AND lat IS NOT NULL
  AND lng IS NOT NULL;
