-- صور إضافية للمنتج (مع image_url كصورة رئيسية)
ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.store_products.image_urls IS 'مصفوفة روابط صور المنتج — الأولى تُكرَّر في image_url';

NOTIFY pgrst, 'reload schema';
