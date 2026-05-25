-- =============================================================================
-- ERVENOW — Pre-flight: تقرير schema الفعلي قبل نقل service_bookings → orders
-- نفّذ في Supabase SQL Editor قبل migration_unification_11_smart_*.sql
-- =============================================================================

-- 1) هل الجداول موجودة؟
SELECT
  t.table_name,
  (SELECT count(*) FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN ('service_bookings', 'service_bookings_legacy', 'orders')
ORDER BY t.table_name;

-- 2) أعمدة service_bookings (أو legacy)
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'service_bookings'
    ) THEN 'service_bookings'
    ELSE 'service_bookings_legacy'
  END
ORDER BY ordinal_position;

-- 3) أعمدة orders
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
ORDER BY ordinal_position;

-- 4) عدّ الصفوف
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='service_bookings')
      THEN (SELECT count(*) FROM public.service_bookings)
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='service_bookings_legacy')
      THEN (SELECT count(*) FROM public.service_bookings_legacy)
    ELSE 0
  END AS service_bookings_rows,
  (SELECT count(*) FROM public.orders WHERE order_type IN ('service', 'gas_delivery')) AS orders_service_rows,
  (SELECT count(*) FROM public.orders o
   WHERE EXISTS (
     SELECT 1 FROM information_schema.tables t
     WHERE t.table_schema='public' AND t.table_name='service_bookings'
   )
   AND EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = o.id)
  ) AS already_migrated_overlap;

-- 5) بعد تثبيت دوال الهجرة من الملف الرئيسي، يمكن معاينة النتيجة:
-- SELECT jsonb_pretty(public.ervenow_smart_migrate_service_bookings());
-- SELECT jsonb_pretty(public.ervenow_smart_migrate_service_bookings_report());
