-- =============================================================================
-- تحديث أقسام المطاعم (بدون حذف الجدول) — نفّذ في Supabase بعد migration_categories.sql
-- يضيف التصنيفات الجديدة ويحدّث الأسماء؛ يُبقي slugs القديمة للمتاجر الموجودة.
-- =============================================================================

INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('restaurant', 'store', 'kabsa_bukhari', 'مطاعم كبسة وبخاري', '🍚', 10, true),
  ('restaurant', 'store', 'shawarma_grill', 'مطاعم شاورما ومشاوي', '🌯', 20, true),
  ('restaurant', 'store', 'seafood', 'مطاعم سمك', '🐟', 30, true),
  ('restaurant', 'store', 'burger', 'مطاعم برقر', '🍔', 40, true),
  ('restaurant', 'store', 'broasted', 'مطاعم بروستد', '🍗', 50, true),
  ('restaurant', 'store', 'pizza', 'مطاعم بيتزا', '🍕', 60, true),
  ('restaurant', 'store', 'cafe', 'مقاهي', '☕', 70, true),
  ('restaurant', 'store', 'sweets', 'حلويات', '🍰', 80, true),
  ('restaurant', 'store', 'home_producers', 'أسر منتجة', '🏠', 90, true)
ON CONFLICT (slug) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  type = EXCLUDED.type,
  scope = EXCLUDED.scope,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

-- تحديث تسميات الصفوف القديمة إن وُجدت (اختياري للوضوح في لوحة الإدارة)
UPDATE public.categories SET name_ar = 'شاورما ومشاوي (قديم)', updated_at = now()
  WHERE slug = 'shawarma_grill' AND type = 'restaurant' AND name_ar = 'شاورما ومشاوي';
-- لا نُجري UPDATE إلزامياً على الصفوف التي حدّثها INSERT أعلاه؛ الأسطر التالية آمنة فقط إن بقيت أسماء قديمة:

UPDATE public.categories SET name_ar = 'مطاعم شاورما ومشاوي', sort_order = 20, updated_at = now()
  WHERE slug = 'shawarma_grill' AND type = 'restaurant';

UPDATE public.categories SET name_ar = 'مأكولات بحرية (قديم) → استخدم مطاعم سمك', updated_at = now()
  WHERE slug = 'seafood' AND type = 'restaurant' AND name_ar NOT LIKE 'مطاعم سمك%';

UPDATE public.categories SET name_ar = 'مطاعم سمك', sort_order = 30, updated_at = now()
  WHERE slug = 'seafood' AND type = 'restaurant';

NOTIFY pgrst, 'reload schema';
