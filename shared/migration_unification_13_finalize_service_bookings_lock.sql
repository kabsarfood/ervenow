-- =============================================================================
-- ERVENOW — Finalize: قفل service_bookings بعد الدمج في orders
-- =============================================================================
-- idempotent — آمن للتكرار.
-- لا يحذف البيانات — يُعيد التسمية ويمنع INSERT / UPDATE / DELETE.
--
-- قبل التنفيذ (اختياري):
--   SELECT to_regclass('public.service_bookings');
--   SELECT to_regclass('public.service_bookings_legacy');
--   SELECT count(*) FROM orders WHERE order_type IN ('service', 'gas_delivery');
--
-- بعد التنفيذ:
--   SELECT to_regclass('public.service_bookings');        -- NULL
--   SELECT to_regclass('public.service_bookings_legacy'); -- موجود
-- =============================================================================

-- ─── 0) تشخيص سريع ─────────────────────────────────────────────────────────
SELECT
  to_regclass('public.service_bookings')        AS service_bookings_before,
  to_regclass('public.service_bookings_legacy') AS service_bookings_legacy_before,
  (SELECT count(*)::bigint FROM public.orders WHERE order_type IN ('service', 'gas_delivery')) AS orders_service_count;

-- ─── 1) إعادة تسمية الجدول (فقط إن وُجد service_bookings) ───────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  ) THEN
    ALTER TABLE public.service_bookings RENAME TO service_bookings_legacy;
    RAISE NOTICE '[finalize] renamed service_bookings → service_bookings_legacy';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  ) THEN
    RAISE NOTICE '[finalize] service_bookings_legacy already exists — skip rename';
  ELSE
    RAISE NOTICE '[finalize] neither service_bookings nor legacy found — skip rename';
  END IF;
END $$;

-- ─── 2) دالة منع الاستخدام ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_service_bookings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'service_bookings disabled - use orders only';
END;
$$;

-- alias للتوافق مع migrations سابقة
CREATE OR REPLACE FUNCTION public.block_service_bookings_legacy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'service_bookings disabled - use orders only';
END;
$$;

-- ─── 3–5) triggers — INSERT / UPDATE / DELETE (فقط إن legacy موجود) ────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  ) THEN
    RAISE EXCEPTION
      'service_bookings_legacy not found — run data migration first (migration_unification_12_repair_service_bookings_merge.sql)';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_insert ON public.service_bookings_legacy';
  EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_update ON public.service_bookings_legacy';
  EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_delete ON public.service_bookings_legacy';
  -- triggers قديمة من migrations سابقة
  EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_bookings_write ON public.service_bookings_legacy';
  EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_bookings_insert ON public.service_bookings_legacy';

  EXECUTE $t$
    CREATE TRIGGER prevent_service_insert
      BEFORE INSERT ON public.service_bookings_legacy
      FOR EACH ROW
      EXECUTE FUNCTION public.block_service_bookings()
  $t$;

  EXECUTE $t$
    CREATE TRIGGER prevent_service_update
      BEFORE UPDATE ON public.service_bookings_legacy
      FOR EACH ROW
      EXECUTE FUNCTION public.block_service_bookings()
  $t$;

  EXECUTE $t$
    CREATE TRIGGER prevent_service_delete
      BEFORE DELETE ON public.service_bookings_legacy
      FOR EACH ROW
      EXECUTE FUNCTION public.block_service_bookings()
  $t$;

  RAISE NOTICE '[finalize] triggers enabled on service_bookings_legacy';
END $$;

-- ─── 6) تحقق نهائي ─────────────────────────────────────────────────────────
SELECT
  to_regclass('public.service_bookings')        AS service_bookings,
  to_regclass('public.service_bookings_legacy') AS service_bookings_legacy,
  (SELECT count(*)::bigint FROM public.orders WHERE order_type = 'service')     AS orders_service,
  (SELECT count(*)::bigint FROM public.orders WHERE order_type = 'gas_delivery') AS orders_gas_delivery,
  (SELECT count(*)::bigint FROM public.orders WHERE order_type IN ('service', 'gas_delivery')) AS orders_service_total;

-- قائمة triggers على legacy
SELECT
  tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'service_bookings_legacy'
  AND NOT t.tgisinternal
ORDER BY tgname;

NOTIFY pgrst, 'reload schema';
