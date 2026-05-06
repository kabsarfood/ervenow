-- لقطة اسم وموقع المتجر على الطلب (للمندوب والتقارير دون JOIN في كل قراءة)

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS store_name text;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS store_address text;

COMMENT ON COLUMN public.orders.store_name IS 'اسم المتجر وقت إنشاء الطلب';
COMMENT ON COLUMN public.orders.store_address IS 'عنوان/وصف موقع المتجر وقت إنشاء الطلب';
