-- =============================================================================
-- ERVENOW — Repair: إكمال دمج service_bookings → orders (state-aware)
-- =============================================================================
-- استخدم هذا الملف إذا فشل migration سابقاً بخطأ:
--   relation "service_bookings_legacy" does not exist
--
-- السبب: migration قديم كان ينشئ TRIGGER على legacy قبل التأكد من وجود الجدول.
-- هذا الملف: يشخّص → ينقل (NOT EXISTS) → يُعيد التسمية → trigger فقط إن وُجد legacy.
--
-- idempotent — آمن للتكرار.
-- =============================================================================

-- ─── 0) تشخيص فوري ─────────────────────────────────────────────────────────
SELECT
  to_regclass('public.service_bookings')      AS service_bookings,
  to_regclass('public.service_bookings_legacy') AS service_bookings_legacy,
  to_regclass('public.orders')                AS orders;

-- ─── 1) دالة تشخيص ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ervenow_diagnose_service_bookings_merge()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sb boolean;
  v_legacy boolean;
  v_orders_service bigint := 0;
  v_orders_gas bigint := 0;
  v_source_rows bigint := 0;
  v_unmigrated bigint := 0;
  v_case text;
BEGIN
  v_sb := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings'
  );
  v_legacy := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  );

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders'
  ) THEN
    SELECT count(*) INTO v_orders_service FROM public.orders WHERE order_type = 'service';
    SELECT count(*) INTO v_orders_gas FROM public.orders WHERE order_type = 'gas_delivery';
  END IF;

  IF v_sb THEN
    EXECUTE 'SELECT count(*) FROM public.service_bookings' INTO v_source_rows;
    EXECUTE $q$
      SELECT count(*) FROM public.service_bookings sb
      WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id)
    $q$ INTO v_unmigrated;
  ELSIF v_legacy THEN
    EXECUTE 'SELECT count(*) FROM public.service_bookings_legacy' INTO v_source_rows;
    EXECUTE $q$
      SELECT count(*) FROM public.service_bookings_legacy sb
      WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id)
    $q$ INTO v_unmigrated;
  END IF;

  v_case := CASE
    WHEN v_sb AND (v_orders_service + v_orders_gas) = 0 THEN 'A_not_migrated'
    WHEN v_sb AND (v_orders_service + v_orders_gas) > 0 THEN 'B_partial'
    WHEN NOT v_sb AND NOT v_legacy AND (v_orders_service + v_orders_gas) = 0 THEN 'C_no_tables_no_data'
    WHEN NOT v_sb AND NOT v_legacy AND (v_orders_service + v_orders_gas) > 0 THEN 'C_complete_or_manual'
    WHEN v_legacy AND NOT v_sb THEN 'D_archived'
    ELSE 'unknown'
  END;

  RETURN jsonb_build_object(
    'case', v_case,
    'service_bookings_exists', v_sb,
    'service_bookings_legacy_exists', v_legacy,
    'orders_service_count', v_orders_service,
    'orders_gas_delivery_count', v_orders_gas,
    'source_rows', v_source_rows,
    'unmigrated_rows', v_unmigrated,
    'action_hint', CASE v_case
      WHEN 'A_not_migrated' THEN 'run_data_migrate_then_rename'
      WHEN 'B_partial' THEN 'run_data_migrate_not_exists_then_rename'
      WHEN 'C_no_tables_no_data' THEN 'investigate_backup_or_empty_db'
      WHEN 'C_complete_or_manual' THEN 'ensure_order_type_backfill_and_optional_trigger'
      WHEN 'D_archived' THEN 'ensure_trigger_on_legacy_only'
      ELSE 'review_manually'
    END
  );
END;
$$;

SELECT jsonb_pretty(public.ervenow_diagnose_service_bookings_merge()) AS diagnosis_before;

-- ─── 2) أعمدة orders (idempotent) ─────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_type text DEFAULT 'delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.users(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_location text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_qty integer DEFAULT 1;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gas_mode text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gas_liters integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS platform_commission numeric(14, 2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_completed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_settled boolean DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_due boolean DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_paid_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_rating integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_review text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_rated_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_status text;

-- backfill order_type لصفوف خدمة بدون نوع (بعد نقل جزئي)
UPDATE public.orders
SET order_type = CASE
  WHEN gas_mode IS NOT NULL OR gas_liters IS NOT NULL
    OR lower(coalesce(service_type, '')) IN ('gas_delivery', 'gas', 'gas-delivery')
    THEN 'gas_delivery'
  ELSE 'service'
END
WHERE order_type IS NULL
  AND (
    service_type IS NOT NULL
    OR service_name IS NOT NULL
    OR provider_id IS NOT NULL
    OR service_provider_id IS NOT NULL
    OR service_location IS NOT NULL
    OR gas_mode IS NOT NULL
  );

-- ─── 3) نقل البيانات — يستدعي الدالة الذكية إن وُجدت ─────────────────────
DO $$
DECLARE
  v_has_fn boolean;
  v_result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ervenow_smart_migrate_service_bookings'
  ) INTO v_has_fn;

  IF v_has_fn THEN
    v_result := public.ervenow_smart_migrate_service_bookings();
    RAISE NOTICE '[repair] smart_migrate result: %', v_result;
  ELSE
    RAISE NOTICE '[repair] ervenow_smart_migrate_service_bookings not found — run migration_unification_11_smart_service_bookings_to_orders.sql first (functions section), then re-run this repair file';
  END IF;
END $$;

-- ─── 3b) نقل fallback مباشر (إذا لم تُثبَّت الدالة الذكية بعد) ─────────────
DO $$
DECLARE
  v_has_fn boolean;
  v_src text;
  v_status_col text;
  v_amount_col text;
  v_stype_col text;
  v_sname_col text;
  v_onum_col text;
  v_sql text;
  v_n bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ervenow_smart_migrate_service_bookings'
  ) INTO v_has_fn;

  IF v_has_fn THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='service_bookings') THEN
    v_src := 'service_bookings';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='service_bookings_legacy') THEN
    v_src := 'service_bookings_legacy';
  ELSE
    RAISE NOTICE '[repair] no source table for fallback migrate';
    RETURN;
  END IF;

  SELECT column_name INTO v_status_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=v_src
    AND column_name = ANY (ARRAY['status','delivery_status','state'])
  ORDER BY array_position(ARRAY['status','delivery_status','state'], column_name)
  LIMIT 1;

  SELECT column_name INTO v_amount_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=v_src
    AND column_name = ANY (ARRAY['total_amount','total','price','amount'])
  ORDER BY array_position(ARRAY['total_amount','total','price','amount'], column_name)
  LIMIT 1;

  SELECT column_name INTO v_stype_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=v_src AND column_name IN ('service_type','type')
  ORDER BY CASE column_name WHEN 'service_type' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT column_name INTO v_sname_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=v_src AND column_name IN ('service_name','title','name')
  ORDER BY CASE column_name WHEN 'service_name' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT column_name INTO v_onum_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=v_src AND column_name IN ('service_order_number','order_number')
  ORDER BY CASE column_name WHEN 'service_order_number' THEN 0 ELSE 1 END
  LIMIT 1;

  v_sql := format(
    $ins$
    INSERT INTO public.orders (
      id, customer_id, order_type, service_type, service_name, delivery_status,
      order_number, total_amount, order_total, created_at, updated_at
    )
    SELECT
      sb.id,
      sb.customer_id,
      'service',
      %s,
      %s,
      %s,
      %s,
      %s,
      %s,
      coalesce(sb.created_at, now()),
      coalesce(sb.updated_at, sb.created_at, now())
    FROM public.%I sb
    WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id)
      %s
    $ins$,
    CASE WHEN v_stype_col IS NOT NULL THEN format('coalesce(sb.%I::text, ''service'')', v_stype_col) ELSE '''service''' END,
    CASE WHEN v_sname_col IS NOT NULL THEN format('sb.%I', v_sname_col) WHEN v_stype_col IS NOT NULL THEN format('sb.%I', v_stype_col) ELSE 'NULL::text' END,
    CASE WHEN v_status_col IS NOT NULL THEN format(
      $st$CASE lower(trim(coalesce(sb.%I::text, 'pending')))
        WHEN 'completed' THEN 'delivered'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'canceled' THEN 'cancelled'
        WHEN 'delivered' THEN 'delivered'
        WHEN 'accepted' THEN 'accepted'
        WHEN 'delivering' THEN 'delivering'
        WHEN 'new' THEN 'pending'
        ELSE 'pending' END$st$, v_status_col
    ) ELSE '''pending''' END,
    CASE WHEN v_onum_col IS NOT NULL THEN format($n$coalesce(nullif(trim(sb.%I::text), ''), 'SV-MIG-' || left(sb.id::text, 8))$n$, v_onum_col)
         ELSE $n$'SV-MIG-' || left(sb.id::text, 8)$n$ END,
    CASE WHEN v_amount_col IS NOT NULL THEN format('coalesce(sb.%I::numeric, 0)', v_amount_col) ELSE '0' END,
    CASE WHEN v_amount_col IS NOT NULL THEN format('coalesce(sb.%I::numeric, 0)', v_amount_col) ELSE '0' END,
    v_src,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=v_src AND column_name='customer_id'
      ) THEN 'AND sb.customer_id IS NOT NULL'
      ELSE ''
    END
  );

  EXECUTE v_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '[repair] fallback migrate inserted % rows from %', v_n, v_src;
END $$;

-- ─── 4) إعادة تسمية آمنة ───────────────────────────────────────────────────
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
    RAISE NOTICE '[repair] renamed service_bookings → service_bookings_legacy';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  ) THEN
  RAISE NOTICE '[repair] both service_bookings AND legacy exist — manual review needed (do not drop without backup)';
  ELSE
    RAISE NOTICE '[repair] rename skipped — service_bookings not found or already archived';
  END IF;
END $$;

-- ─── 5) trigger — فقط إذا legacy موجود ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_service_bookings_legacy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'service_bookings disabled — use orders (order_type=service|gas_delivery)';
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_bookings_write ON public.service_bookings_legacy';
    EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_bookings_insert ON public.service_bookings_legacy';
    EXECUTE $trg$
      CREATE TRIGGER prevent_service_bookings_write
        BEFORE INSERT OR UPDATE OR DELETE ON public.service_bookings_legacy
        FOR EACH ROW EXECUTE FUNCTION public.block_service_bookings_legacy()
    $trg$;
    RAISE NOTICE '[repair] trigger enabled on service_bookings_legacy';
  ELSE
    RAISE NOTICE '[repair] trigger skipped — service_bookings_legacy does not exist';
  END IF;
END $$;

-- ─── 6) تحقق نهائي ─────────────────────────────────────────────────────────
SELECT jsonb_pretty(public.ervenow_diagnose_service_bookings_merge()) AS diagnosis_after;

SELECT
  to_regclass('public.service_bookings')      AS service_bookings,
  to_regclass('public.service_bookings_legacy') AS service_bookings_legacy,
  (SELECT count(*) FROM public.orders WHERE order_type IN ('service', 'gas_delivery')) AS orders_service_total,
  (SELECT count(*) FROM public.ervenow_migration_skipped_rows) AS skipped_rows_logged;

NOTIFY pgrst, 'reload schema';
