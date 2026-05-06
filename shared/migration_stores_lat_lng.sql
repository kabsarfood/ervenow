-- =============================================================================
-- إصلاح جذري: Could not find the 'lat' / 'lng' column of 'stores' in the schema cache
-- يحدث عندما وُجد جدول stores قديماً أو يدوياً بدون أعمدة الإحداثيات.
-- نفّذ في Supabase → SQL Editor (آمن: IF NOT EXISTS)
-- =============================================================================

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS lng double precision;

COMMENT ON COLUMN public.stores.lat IS 'خط العرض — موقع المتجر على الخريطة';
COMMENT ON COLUMN public.stores.lng IS 'خط الطول — موقع المتجر على الخريطة';
