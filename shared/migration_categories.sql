-- =============================================================================
-- أقسام مركزية (مطاعم + أسواق) — عرض وإدارة فقط؛ لا تغيّر stores.category ولا store_products.category
-- نفّذ في Supabase → SQL Editor ثم Reload schema عند الحاجة.
--
-- تحذير: السطر التالي يحذف الجدول القديم بالكامل إن وُجد. احفظ نسخة إن لديك بيانات.
-- =============================================================================

DROP TABLE IF EXISTS public.categories CASCADE;

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('restaurant', 'market')),
  scope text NOT NULL CHECK (scope IN ('store', 'product')),
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  icon text,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_type_scope_active_sort
  ON public.categories (type, scope, is_active, sort_order);

COMMENT ON TABLE public.categories IS 'أقسام العرض والإدارة: type+scope يحددان الاستخدام (مطعم/متجر vs سوق/منتج)';

-- مطاعم (scope = store → يطابق stores.category للمطاعم)
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
ON CONFLICT (slug) DO NOTHING;

-- سوبرماركت / منتجات (scope = product → يطابق store_products.category)
INSERT INTO public.categories (type, scope, slug, name_ar, sort_order, is_active)
VALUES
  ('market', 'product', 'vegetables', 'خضار وفواكه', 10, true),
  ('market', 'product', 'meat', 'لحوم', 20, true),
  ('market', 'product', 'dairy', 'ألبان', 30, true),
  ('market', 'product', 'cleaning', 'منظفات', 40, true),
  ('market', 'product', 'bakery', 'مخبوزات', 50, true),
  ('market', 'product', 'drinks', 'مشروبات', 60, true),
  ('market', 'product', 'snacks', 'سناكات', 70, true),
  ('market', 'product', 'frozen', 'مجمدات', 80, true)
ON CONFLICT (slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';
