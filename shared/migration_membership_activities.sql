-- أنشطة إنشاء العضوية داخل جدول categories الموجود (scope = store)
-- نفّذ بعد migration_categories.sql و migration_categories_extended_types.sql
-- الإضافة لاحقاً من لوحة الأقسام: متجر / نقل / خدمات — نشاط التسجيل

INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('market', 'store', 'supermarket', 'سوبرماركت', '🛒', 10, true),
  ('market', 'store', 'minimarket', 'ميني ماركت', '🏪', 20, true),
  ('market', 'store', 'pharmacy', 'صيدلية', '💊', 30, true),
  ('market', 'store', 'beauty_care', 'تجميل وعناية', '✨', 40, true),
  ('market', 'store', 'flowers_gifts', 'ورود وهدايا', '💐', 50, true),
  ('market', 'store', 'clothing', 'ملابس', '👗', 60, true),
  ('market', 'store', 'vegetables', 'خضار', '🥬', 70, true),
  ('market', 'store', 'butcher', 'ملحمة', '🥩', 80, true),
  ('market', 'store', 'fish', 'بيع أسماك', '🐟', 90, true),
  ('market', 'store', 'sweets', 'حلويات', '🍰', 100, true),
  ('market', 'store', 'home_business', 'أسرة منتجة', '🏠', 110, true),
  ('market', 'store', 'other', 'غيره', '➕', 120, true),
  ('transport', 'store', 'pickup_truck', 'سطحة', '🚛', 10, true),
  ('transport', 'store', 'furniture_move', 'نقل أثاث', '🛋️', 20, true),
  ('transport', 'store', 'internal_delivery', 'توصيل طرود', '📦', 30, true),
  ('services', 'store', 'plumber', 'سباك', '🔧', 10, true),
  ('services', 'store', 'electrician', 'كهربائي', '⚡', 20, true),
  ('services', 'store', 'ac_technician', 'فني مكيفات', '❄️', 30, true),
  ('services', 'store', 'agricultural_engineer', 'تشجير', '🌳', 40, true),
  ('services', 'store', 'laundry_estates', 'غسيل وتنظيف فلل وعمائر وشقق', '🧹', 50, true),
  ('services', 'store', 'car_polishing', 'تلميع مركبات', '🚗', 60, true),
  ('services', 'store', 'gas_cylinder_swap', 'تبديل غاز', '🔥', 70, true),
  ('services', 'store', 'gas_central_refill', 'تعبئة غاز', '⛽', 80, true)
ON CONFLICT (type, scope, slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';
