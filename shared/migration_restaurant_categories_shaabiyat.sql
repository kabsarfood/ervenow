-- شعبيات فوال + شعبيات فلافل — نفّذ في Supabase بعد migration_restaurant_categories_v2.sql

INSERT INTO public.categories (type, scope, slug, name_ar, icon, sort_order, is_active)
VALUES
  ('restaurant', 'store', 'shaabiyat_foul', 'شعبيات فوال', '🫘', 85, true),
  ('restaurant', 'store', 'shaabiyat_falafel', 'شعبيات فلافل', '🧆', 86, true)
ON CONFLICT (slug) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  type = EXCLUDED.type,
  scope = EXCLUDED.scope,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
