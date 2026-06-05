-- =============================================================================
-- Hotfix: إظهار مطعم كبسار (وأي مطعم باسم مشابه) في تصنيفات المطاعم
-- نفّذ يدوياً في Supabase SQL Editor عند الحاجة
-- =============================================================================

UPDATE public.stores
SET
  type = 'restaurant',
  category = COALESCE(NULLIF(trim(category), ''), 'kabsa_bukhari'),
  is_active = true,
  updated_at = now()
WHERE status = 'approved'
  AND (
    lower(name) LIKE '%kabsar%'
    OR name LIKE '%كبسار%'
    OR name LIKE '%كبسة%'
  );

-- SELECT id, name, type, category, status, is_active FROM public.stores WHERE name ILIKE '%kabsar%' OR name LIKE '%كبسار%';
