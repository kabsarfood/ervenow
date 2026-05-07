-- =============================================================================
-- أقسام ديناميكية (مطاعم + سوبرماركت) — تُدار من لوحة الأدمن
-- نفّذ في Supabase → SQL Editor
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('restaurant', 'market')),
  slug text NOT NULL,
  label_ar text NOT NULL,
  icon text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_type_active_sort ON public.categories (type, is_active, sort_order);

COMMENT ON TABLE public.categories IS 'أقسام العرض: مطاعم (type=restaurant) ومنتجات بقالة (type=market)';

-- بذور افتراضية (يمكن تعديلها من /admin/categories)
INSERT INTO public.categories (type, slug, label_ar, icon, sort_order, is_active)
VALUES
  ('restaurant', 'shawarma_grill', 'شاورما ومشاوي', '🌯', 10, true),
  ('restaurant', 'bukhari_mandi', 'بخاري ومندي', '🍲', 20, true),
  ('restaurant', 'burger_broasted', 'برقر وبروستد', '🍔', 30, true),
  ('restaurant', 'seafood', 'مأكولات بحرية', '🐟', 40, true),
  ('restaurant', 'kabsa', 'كبسة', '🍛', 50, true),
  ('restaurant', 'breakfast_bakery', 'فطور ومخابز', '🥐', 60, true),
  ('restaurant', 'dessert_cafe', 'حلويات وقهوة', '🍰', 70, true),
  ('restaurant', 'juice_drinks', 'عصائر ومشروبات', '🥤', 80, true),
  ('market', 'vegetables', 'خضار وفواكه', '🥬', 10, true),
  ('market', 'meat', 'لحوم', '🥩', 20, true),
  ('market', 'dairy', 'ألبان', '🥛', 30, true),
  ('market', 'bakery', 'مخبوزات', '🍞', 40, true),
  ('market', 'drinks', 'مشروبات', '🥤', 50, true),
  ('market', 'snacks', 'سناكات', '🍿', 60, true),
  ('market', 'frozen', 'مجمدات', '🧊', 70, true),
  ('market', 'cleaning', 'منظفات', '🧽', 80, true)
ON CONFLICT (type, slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';
