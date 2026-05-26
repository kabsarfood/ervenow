-- =============================================================================
-- ERVENOW — تشخيص نظام withdraw (Supabase SQL Editor)
-- انسخ النتائج كاملة عند طلب الدعم.
-- =============================================================================

-- ─── 1) جداول تحتوي withdraw ───────────────────────────────────────────────
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%withdraw%'
ORDER BY table_name;

-- ─── 2) Views فقط ───────────────────────────────────────────────────────────
SELECT table_name AS view_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name LIKE '%withdraw%'
ORDER BY table_name;

-- ─── 3) نوع الكائن (جدول / view / أرشيف) ───────────────────────────────────
SELECT
  c.relname AS name,
  CASE c.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED VIEW'
    ELSE c.relkind::text
  END AS kind,
  obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE '%withdraw%'
ORDER BY c.relname;

-- ─── 4) أعمدة withdraw_requests (إن وُجد) ───────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'withdraw_requests'
ORDER BY ordinal_position;

-- ─── 5) أعمدة ervenow_withdraw_requests (إن وُجد) ───────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ervenow_withdraw_requests'
ORDER BY ordinal_position;

-- ─── 6) عدد الصفوف ─────────────────────────────────────────────────────────
SELECT
  to_regclass('public.withdraw_requests') IS NOT NULL AS has_withdraw_requests,
  to_regclass('public.ervenow_withdraw_requests') IS NOT NULL AS has_ervenow_withdraw_requests,
  to_regclass('public.withdraw_requests_ledger_archive') IS NOT NULL AS has_archive;

DO $$
BEGIN
  IF to_regclass('public.withdraw_requests') IS NOT NULL THEN
    RAISE NOTICE 'withdraw_requests count: %', (SELECT count(*) FROM public.withdraw_requests);
  ELSE
    RAISE NOTICE 'withdraw_requests: MISSING';
  END IF;
  IF to_regclass('public.ervenow_withdraw_requests') IS NOT NULL THEN
    RAISE NOTICE 'ervenow_withdraw_requests count: %', (SELECT count(*) FROM public.ervenow_withdraw_requests);
  ELSE
    RAISE NOTICE 'ervenow_withdraw_requests: MISSING';
  END IF;
END $$;

-- ─── 7) عينة بيانات (5 صفوف — نفّذ كل SELECT فقط إن وُجد الجدول) ─────────
-- SELECT * FROM public.withdraw_requests LIMIT 5;
-- SELECT * FROM public.ervenow_withdraw_requests LIMIT 5;

DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.withdraw_requests') IS NOT NULL THEN
    FOR r IN SELECT * FROM public.withdraw_requests LIMIT 5 LOOP
      RAISE NOTICE 'withdraw_requests sample: %', r;
    END LOOP;
  END IF;
  IF to_regclass('public.ervenow_withdraw_requests') IS NOT NULL THEN
    FOR r IN SELECT * FROM public.ervenow_withdraw_requests LIMIT 5 LOOP
      RAISE NOTICE 'ervenow_withdraw_requests sample: %', r;
    END LOOP;
  END IF;
END $$;

-- ─── 8) RPCs المرتبطة بالسحب ────────────────────────────────────────────────
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname LIKE '%withdraw%'
    OR p.proname IN (
      'ledger_withdraw_request_approve',
      'ervenow_ledger_withdraw_atomic',
      'ervenow_wallet_withdraw_atomic'
    )
  )
ORDER BY p.proname;

-- ─── 9) من أي جدول تقرأ دالة الموافقة ledger؟ (تعريف مختصر) ───────────────
SELECT pg_get_functiondef(p.oid) AS ledger_withdraw_request_approve_def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'ledger_withdraw_request_approve'
LIMIT 1;

-- ─── 10) RLS على الجداول ───────────────────────────────────────────────────
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE '%withdraw%';

-- ─── 11) ملخص تشخيصي تلقائي ────────────────────────────────────────────────
SELECT
  CASE
    WHEN to_regclass('public.ervenow_withdraw_requests') IS NULL THEN 'CRITICAL: ervenow_withdraw_requests غير موجود — نفّذ migration_ervenow_withdraw_requests_schema_cache.sql'
    ELSE 'OK: ervenow_withdraw_requests موجود'
  END AS ervenow_table_status,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind = 'v'
    ) THEN 'withdraw_requests = VIEW (متوافق مع refactor_02)'
    WHEN EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind = 'r'
    ) THEN 'WARN: withdraw_requests = TABLE منفصل — تضارب محتمل مع backend'
    WHEN to_regclass('public.withdraw_requests') IS NULL THEN 'withdraw_requests غير موجود (مقبول إن كان كل شيء على ervenow_)'
    ELSE 'withdraw_requests: حالة أخرى'
  END AS withdraw_requests_status,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'ledger_withdraw_request_approve'
    ) THEN 'OK: ledger_withdraw_request_approve موجود'
    ELSE 'WARN: RPC ledger_withdraw_request_approve ناقص'
  END AS approve_rpc_status;
