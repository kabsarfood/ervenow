-- توسيع أنواع الأقسام: مطاعم (منتجات)، صيدليات، خدمات، نقل، محطات، ملابس
-- نفّذ بعد migration_categories.sql

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_type_scope_slug_uidx
  ON public.categories (type, scope, slug);

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_type_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_type_check CHECK (
    type IN ('restaurant', 'market', 'pharmacy', 'services', 'transport', 'fuel', 'clothing')
  );

-- مطاعم — أقسام قائمة/منتجات (scope = product)
INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('restaurant', 'product', 'kabsa_bukhari', 'مطاعم كبسة وبخاري', '🍚', 10, true),
  ('restaurant', 'product', 'shawarma_grill', 'مطاعم شاورما ومشاوي', '🌯', 20, true),
  ('restaurant', 'product', 'seafood', 'مطاعم سمك', '🐟', 30, true),
  ('restaurant', 'product', 'burger', 'مطاعم برقر', '🍔', 40, true),
  ('restaurant', 'product', 'broasted', 'مطاعم بروستد', '🍗', 50, true),
  ('restaurant', 'product', 'pizza', 'مطاعم بيتزا', '🍕', 60, true),
  ('restaurant', 'product', 'cafe', 'مقاهي', '☕', 70, true),
  ('restaurant', 'product', 'sweets', 'حلويات', '🍰', 80, true),
  ('restaurant', 'product', 'home_producers', 'أسر منتجة', '🏠', 90, true),
  ('restaurant', 'product', 'appetizers', 'مقبلات', '🥗', 100, true),
  ('restaurant', 'product', 'main_dishes', 'أطباق رئيسية', '🍽️', 110, true),
  ('restaurant', 'product', 'drinks_menu', 'مشروبات', '🥤', 120, true)
ON CONFLICT (slug) DO NOTHING;

-- صيدليات
INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('pharmacy', 'product', 'medicines', 'أدوية', '💊', 10, true),
  ('pharmacy', 'product', 'vitamins', 'فيتامينات ومكملات', '🧴', 20, true),
  ('pharmacy', 'product', 'cosmetics', 'عناية وتجميل', '✨', 30, true),
  ('pharmacy', 'product', 'baby_care', 'أم وطفل', '👶', 40, true),
  ('pharmacy', 'product', 'medical_devices', 'أجهزة طبية', '🩺', 50, true)
ON CONFLICT (slug) DO NOTHING;

-- مزودو الخدمات
INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('services', 'product', 'home_maintenance', 'صيانة منزلية', '🔧', 10, true),
  ('services', 'product', 'installation', 'تركيب', '🛠️', 20, true),
  ('services', 'product', 'cleaning_service', 'تنظيف', '🧹', 30, true),
  ('services', 'product', 'consultation', 'استشارات', '📋', 40, true),
  ('services', 'product', 'packages', 'باقات خدمات', '📦', 50, true)
ON CONFLICT (slug) DO NOTHING;

-- شركات النقل
INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('transport', 'product', 'local_delivery', 'توصيل داخل المدينة', '🚚', 10, true),
  ('transport', 'product', 'intercity', 'نقل بين المدن', '🛣️', 20, true),
  ('transport', 'product', 'heavy_cargo', 'بضائع ثقيلة', '📦', 30, true),
  ('transport', 'product', 'vehicle_move', 'نقل مركبات', '🚗', 40, true),
  ('transport', 'product', 'furniture_move', 'نقل أثاث', '🛋️', 50, true)
ON CONFLICT (slug) DO NOTHING;

-- محطات / غاز
INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('fuel', 'product', 'gas_cylinder', 'أسطوانات غاز', '🔥', 10, true),
  ('fuel', 'product', 'gas_refill', 'تعبئة غاز', '⛽', 20, true),
  ('fuel', 'product', 'fuel_station_shop', 'منتجات المحطة', '🏪', 30, true),
  ('fuel', 'product', 'car_care', 'عناية بالمركبة', '🚘', 40, true)
ON CONFLICT (slug) DO NOTHING;

-- ملابس
INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('clothing', 'product', 'men', 'رجالي', '👔', 10, true),
  ('clothing', 'product', 'women', 'نسائي', '👗', 20, true),
  ('clothing', 'product', 'kids', 'أطفال', '👶', 30, true),
  ('clothing', 'product', 'shoes', 'أحذية', '👟', 40, true),
  ('clothing', 'product', 'accessories', 'إكسسوارات', '👜', 50, true)
ON CONFLICT (slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';
