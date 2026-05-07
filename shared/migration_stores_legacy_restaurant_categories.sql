-- =============================================================================
-- ترحيل تصنيف المطاعم القديم (stores.category = 'restaurant' أو فارغ)
-- نفّذ في Supabase → SQL Editor بعد مراجعة النتائج (يفضّل نسخة احتياطية).
-- ترتيب التحديثات: من الأكثر تحديداً إلى الأقل، ثم التعيين الافتراضي اختياري.
-- =============================================================================

-- مثال المطلوب: مطاعم «كبسة» بالاسم
UPDATE public.stores
SET category = 'kabsa'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND name ILIKE '%كبس%';

-- شاورما / مشاوي
UPDATE public.stores
SET category = 'shawarma_grill'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%شاورما%'
    OR name ILIKE '%مشاوي%'
    OR name ILIKE '%شوارمة%'
  );

-- بخاري / مندي
UPDATE public.stores
SET category = 'bukhari_mandi'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%بخاري%'
    OR name ILIKE '%مندي%'
    OR name ILIKE '%مندى%'
  );

-- برجر / بروست
UPDATE public.stores
SET category = 'burger_broasted'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%برجر%'
    OR name ILIKE '%بروست%'
    OR name ILIKE '%broast%'
  );

-- مأكولات بحرية
UPDATE public.stores
SET category = 'seafood'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%بحري%'
    OR name ILIKE '%سمك%'
    OR name ILIKE '%سي فوود%'
    OR name ILIKE '%seafood%'
  );

-- فطور / مخبز / كرواسان
UPDATE public.stores
SET category = 'breakfast_bakery'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%فطور%'
    OR name ILIKE '%مخبز%'
    OR name ILIKE '%مخابز%'
    OR name ILIKE '%كرواس%'
    OR name ILIKE '%بيكري%'
  );

-- حلويات / قهوة / كافيه
UPDATE public.stores
SET category = 'dessert_cafe'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%حلو%'
    OR name ILIKE '%قهوة%'
    OR name ILIKE '%كافيه%'
    OR name ILIKE '%كوفي%'
    OR name ILIKE '%عصائر%'
    OR name ILIKE '%مشروب%'
  );

-- عصائر ومشروبات (إن بقيت بعد السطر السابق — يمكن دمجها يدوياً حسب أسمائكم)
UPDATE public.stores
SET category = 'juice_drinks'
WHERE type = 'restaurant'
  AND lower(trim(coalesce(category, ''))) IN ('restaurant', '')
  AND (
    name ILIKE '%عصير%'
    OR name ILIKE '%عصائر%'
    OR name ILIKE '%مشروبات%'
  );

-- =============================================================================
-- اختياري (افتح التعليق بعد المراجعة):
-- تعيين افتراضي لأي مطعم ما زال category = restaurant أو فارغ — يظهر تحت
-- فلتر «شاورما ومشاوي» حتى تعدّله يدوياً إلى التصنيف الصحيح.
-- =============================================================================
-- UPDATE public.stores
-- SET category = 'shawarma_grill'
-- WHERE type = 'restaurant'
--   AND lower(trim(coalesce(category, ''))) IN ('restaurant', '');
