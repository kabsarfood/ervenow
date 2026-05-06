-- =============================================================================
-- توسيع جدول stores لمنصة متعددة المتاجر (نشاط، تسجيل تجاري، ظهور في المنصة)
-- نفّذ في Supabase → SQL Editor بعد migration_stores.sql وملفات المتجر الأخرى عند الحاجة
-- =============================================================================

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS category text;

UPDATE public.stores
SET category = type
WHERE category IS NULL AND type IS NOT NULL;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS commercial_registration text;

UPDATE public.stores
SET commercial_registration = NULLIF(trim(commercial_register), '')
WHERE commercial_registration IS NULL AND commercial_register IS NOT NULL;

UPDATE public.stores
SET is_active = true
WHERE lower(trim(status)) = 'approved';

COMMENT ON COLUMN public.stores.is_active IS 'يظهر المتجر في قوائم المنصة عند الموافقة وtrue';
COMMENT ON COLUMN public.stores.category IS 'فئة العرض — تطابق type عادةً';
COMMENT ON COLUMN public.stores.commercial_registration IS 'السجل التجاري (نسخة معرضة؛ قد يطابق commercial_register)';
