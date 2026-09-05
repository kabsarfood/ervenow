-- اسم وجوال من عبّأ طلب تسجيل المتجر (إلزامي من التطبيق)
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS applicant_name text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS applicant_phone text;

COMMENT ON COLUMN public.stores.applicant_name IS 'اسم الشخص الذي عبّأ نموذج التسجيل';
COMMENT ON COLUMN public.stores.applicant_phone IS 'جوال من عبّأ النموذج (9665xxxxxxxx)';
