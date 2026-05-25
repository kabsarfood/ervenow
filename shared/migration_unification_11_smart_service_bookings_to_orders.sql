-- =============================================================================
-- ERVENOW — Smart Migration: service_bookings → orders
-- =============================================================================
-- يقرأ schema الفعلي من information_schema عند التشغيل (لا يفترض أسماء أعمدة).
-- idempotent: آمن للتكرار — NOT EXISTS + لا يعيد نقل الصفوف الموجودة.
--
-- قبل التنفيذ (اختياري — تشخيص):
--   \i shared/migration_unification_11_preflight_schema_report.sql
--
-- بعد التنفيذ (تحقق):
--   SELECT public.ervenow_smart_migrate_service_bookings_report();
--   SELECT count(*) FROM orders WHERE order_type IN ('service','gas_delivery');
-- =============================================================================

-- ─── 1) أعمدة orders الناقصة (idempotent) ───────────────────────────────────
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

COMMENT ON COLUMN public.orders.order_type IS 'delivery | store | restaurant | service | gas_delivery';
COMMENT ON COLUMN public.orders.provider_id IS 'مزود الخدمة — يُزامَن مع service_provider_id';

CREATE INDEX IF NOT EXISTS idx_orders_provider ON public.orders (provider_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON public.orders (order_type);
CREATE INDEX IF NOT EXISTS idx_orders_service_type ON public.orders (service_type)
  WHERE order_type IN ('service', 'gas_delivery');

-- ─── 2) سجل الصفوف المتخطاة (لا فقدان — للمراجعة اليدوية) ─────────────────
CREATE TABLE IF NOT EXISTS public.ervenow_migration_skipped_rows (
  id uuid NOT NULL,
  source_table text NOT NULL,
  reason text NOT NULL,
  row_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ervenow_migration_skipped_rows_src_idx
  ON public.ervenow_migration_skipped_rows (source_table, created_at DESC);

-- ─── 3) دوال مساعدة ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ervenow_table_exists(p_table text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = p_table
  );
$$;

CREATE OR REPLACE FUNCTION public.ervenow_col_exists(p_table text, p_col text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_col
  );
$$;

CREATE OR REPLACE FUNCTION public.ervenow_pick_col(p_table text, p_candidates text[])
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c text;
BEGIN
  IF p_candidates IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH c IN ARRAY p_candidates LOOP
    IF public.ervenow_col_exists(p_table, c) THEN
      RETURN c;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_sb_status_expr(p_table text, p_status_col text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_status_col IS NULL THEN
    RETURN '''pending''::text';
  END IF;
  -- completed → delivered | cancelled → cancelled | حالات معروفة تُحفظ | غير ذلك → pending
  RETURN format(
    $expr$
    CASE lower(trim(coalesce(sb.%I::text, 'pending')))
      WHEN 'completed' THEN 'delivered'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'canceled' THEN 'cancelled'
      WHEN 'cancelled_by_customer' THEN 'cancelled'
      WHEN 'delivered' THEN 'delivered'
      WHEN 'accepted' THEN 'accepted'
      WHEN 'delivering' THEN 'delivering'
      WHEN 'pending' THEN 'pending'
      WHEN 'new' THEN 'pending'
      ELSE 'pending'
    END
    $expr$,
    p_status_col
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_sb_order_type_expr(
  p_table text,
  p_service_type_col text,
  p_gas_mode_col text,
  p_gas_liters_col text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  parts text[] := ARRAY[]::text[];
BEGIN
  IF p_gas_mode_col IS NOT NULL THEN
    parts := parts || format('sb.%I IS NOT NULL', p_gas_mode_col);
  END IF;
  IF p_gas_liters_col IS NOT NULL THEN
    parts := parts || format('sb.%I IS NOT NULL', p_gas_liters_col);
  END IF;
  IF p_service_type_col IS NOT NULL THEN
    parts := parts || format(
      $c$lower(trim(coalesce(sb.%I::text, ''))) IN ('gas_delivery', 'gas', 'gas-delivery')$c$,
      p_service_type_col
    );
  END IF;
  IF array_length(parts, 1) IS NULL THEN
    RETURN '''service''::text';
  END IF;
  RETURN format(
    'CASE WHEN %s THEN ''gas_delivery''::text ELSE ''service''::text END',
    array_to_string(parts, ' OR ')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_sb_extra_data_expr(
  p_table text,
  p_used_cols text[]
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  col record;
  pairs text[] := ARRAY[]::text[];
  v_base text;
BEGIN
  IF public.ervenow_col_exists(p_table, 'data') THEN
    v_base := 'coalesce(sb.data, ''{}''::jsonb)';
  ELSE
    v_base := '''{}''::jsonb';
  END IF;

  FOR col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name <> ALL (coalesce(p_used_cols, ARRAY[]::text[]))
      AND column_name <> 'data'
    ORDER BY ordinal_position
  LOOP
    pairs := pairs || format('%L, sb.%I', col.column_name, col.column_name);
  END LOOP;

  IF array_length(pairs, 1) IS NULL THEN
    RETURN format(
      $j$%s || jsonb_build_object('migrated_from', %L, 'migrated_at', now())$j$,
      v_base,
      p_table
    );
  END IF;

  RETURN format(
    $j$%s || jsonb_strip_nulls(jsonb_build_object(%s))
      || jsonb_build_object('migrated_from', %L, 'migrated_at', now())$j$,
    v_base,
    array_to_string(pairs, ', '),
    p_table
  );
END;
$$;

-- ─── 4) الدالة الرئيسية — بناء INSERT ديناميكي ─────────────────────────────

CREATE OR REPLACE FUNCTION public.ervenow_smart_migrate_service_bookings()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_src_table text;
  v_status_col text;
  v_amount_col text;
  v_service_type_col text;
  v_service_name_col text;
  v_order_number_col text;
  v_customer_id_col text;
  v_customer_phone_col text;
  v_provider_col text;
  v_location_col text;
  v_qty_col text;
  v_payment_col text;
  v_commission_col text;
  v_gas_mode_col text;
  v_gas_liters_col text;
  v_district_col text;
  v_notes_col text;
  v_scheduled_col text;
  v_rating_col text;
  v_review_col text;
  v_rated_at_col text;
  v_provider_done_col text;
  v_customer_done_col text;
  v_comm_settled_col text;
  v_comm_due_col text;
  v_comm_paid_col text;
  v_created_col text;
  v_updated_col text;

  v_insert_cols text[] := ARRAY[]::text[];
  v_select_exprs text[] := ARRAY[]::text[];
  v_used_src_cols text[] := ARRAY[]::text[];
  v_sql text;
  v_inserted bigint := 0;
  v_skipped bigint := 0;
  v_total_src bigint := 0;
  v_customer_required boolean := false;
  v_data_expr text;
  v_report jsonb;
BEGIN
  -- مصدر البيانات
  IF public.ervenow_table_exists('service_bookings') THEN
    v_src_table := 'service_bookings';
  ELSIF public.ervenow_table_exists('service_bookings_legacy') THEN
    v_src_table := 'service_bookings_legacy';
  ELSE
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'no_source_table',
      'hint', 'service_bookings or service_bookings_legacy not found'
    );
  END IF;

  IF NOT public.ervenow_table_exists('orders') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'orders_table_missing');
  END IF;

  SELECT count(*) INTO v_total_src FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = v_src_table AND c.relkind = 'r';

  -- هل customer_id إلزامي في orders؟
  SELECT (is_nullable = 'NO') INTO v_customer_required
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'orders'
    AND column_name = 'customer_id';

  -- اكتشاف أعمدة المصدر (أول مطابق من قائمة مرشّحين)
  v_status_col := public.ervenow_pick_col(v_src_table, ARRAY['status', 'delivery_status', 'state', 'booking_status']);
  v_amount_col := public.ervenow_pick_col(v_src_table, ARRAY['total_amount', 'total', 'price', 'amount', 'order_total']);
  v_service_type_col := public.ervenow_pick_col(v_src_table, ARRAY['service_type', 'type', 'category']);
  v_service_name_col := public.ervenow_pick_col(v_src_table, ARRAY['service_name', 'title', 'name']);
  v_order_number_col := public.ervenow_pick_col(v_src_table, ARRAY['service_order_number', 'order_number', 'booking_number']);
  v_customer_id_col := public.ervenow_pick_col(v_src_table, ARRAY['customer_id', 'user_id', 'client_id']);
  v_customer_phone_col := public.ervenow_pick_col(v_src_table, ARRAY['customer_phone', 'phone', 'mobile']);
  v_provider_col := public.ervenow_pick_col(v_src_table, ARRAY['provider_id', 'service_provider_id']);
  v_location_col := public.ervenow_pick_col(v_src_table, ARRAY['location', 'service_location', 'address', 'drop_address']);
  v_qty_col := public.ervenow_pick_col(v_src_table, ARRAY['qty', 'quantity', 'service_qty']);
  v_payment_col := public.ervenow_pick_col(v_src_table, ARRAY['payment_status', 'pay_status']);
  v_commission_col := public.ervenow_pick_col(v_src_table, ARRAY['platform_commission', 'commission', 'platform_fee']);
  v_gas_mode_col := public.ervenow_pick_col(v_src_table, ARRAY['gas_mode', 'gas_type']);
  v_gas_liters_col := public.ervenow_pick_col(v_src_table, ARRAY['gas_liters', 'liters']);
  v_district_col := public.ervenow_pick_col(v_src_table, ARRAY['district', 'area', 'neighborhood']);
  v_notes_col := public.ervenow_pick_col(v_src_table, ARRAY['notes', 'description', 'comment']);
  v_scheduled_col := public.ervenow_pick_col(v_src_table, ARRAY['scheduled_at', 'scheduled_for', 'appointment_at']);
  v_rating_col := public.ervenow_pick_col(v_src_table, ARRAY['rating', 'service_rating']);
  v_review_col := public.ervenow_pick_col(v_src_table, ARRAY['review', 'service_review', 'feedback']);
  v_rated_at_col := public.ervenow_pick_col(v_src_table, ARRAY['rated_at', 'service_rated_at']);
  v_provider_done_col := public.ervenow_pick_col(v_src_table, ARRAY['provider_completed_at']);
  v_customer_done_col := public.ervenow_pick_col(v_src_table, ARRAY['customer_confirmed_at']);
  v_comm_settled_col := public.ervenow_pick_col(v_src_table, ARRAY['commission_settled']);
  v_comm_due_col := public.ervenow_pick_col(v_src_table, ARRAY['commission_due']);
  v_comm_paid_col := public.ervenow_pick_col(v_src_table, ARRAY['commission_paid_at']);
  v_created_col := public.ervenow_pick_col(v_src_table, ARRAY['created_at']);
  v_updated_col := public.ervenow_pick_col(v_src_table, ARRAY['updated_at']);

  -- ── id (إلزامي) ──
  IF public.ervenow_col_exists(v_src_table, 'id') AND public.ervenow_col_exists('orders', 'id') THEN
    v_insert_cols := v_insert_cols || 'id';
    v_select_exprs := v_select_exprs || 'sb.id';
    v_used_src_cols := v_used_src_cols || 'id';
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'source_id_column_missing');
  END IF;

  -- ── customer_id (مع fallback بالجوال) ──
  IF public.ervenow_col_exists('orders', 'customer_id') THEN
    v_insert_cols := v_insert_cols || 'customer_id';
    IF v_customer_id_col IS NOT NULL THEN
      v_used_src_cols := v_used_src_cols || v_customer_id_col;
    END IF;
    IF v_customer_phone_col IS NOT NULL THEN
      v_used_src_cols := v_used_src_cols || v_customer_phone_col;
    END IF;
    v_select_exprs := v_select_exprs || format(
      $cid$coalesce(
        %s,
        (
          SELECT u.id
          FROM public.users u
          WHERE %s
          LIMIT 1
        )
      )$cid$,
      CASE WHEN v_customer_id_col IS NOT NULL THEN format('sb.%I', v_customer_id_col) ELSE 'NULL::uuid' END,
      CASE
        WHEN v_customer_phone_col IS NOT NULL THEN
          format(
            $ph$regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(sb.%I::text, ''), '\D', '', 'g')
              AND regexp_replace(coalesce(sb.%I::text, ''), '\D', '', 'g') <> ''$ph$,
            v_customer_phone_col, v_customer_phone_col
          )
        ELSE 'false'
      END
    );
  END IF;

  -- ── customer_phone ──
  IF public.ervenow_col_exists('orders', 'customer_phone') AND v_customer_phone_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'customer_phone';
    v_select_exprs := v_select_exprs || format('sb.%I', v_customer_phone_col);
    v_used_src_cols := v_used_src_cols || v_customer_phone_col;
  END IF;

  -- ── provider ──
  IF public.ervenow_col_exists('orders', 'provider_id') AND v_provider_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'provider_id';
    v_select_exprs := v_select_exprs || format('sb.%I', v_provider_col);
    v_used_src_cols := v_used_src_cols || v_provider_col;
  END IF;
  IF public.ervenow_col_exists('orders', 'service_provider_id') AND v_provider_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'service_provider_id';
    v_select_exprs := v_select_exprs || format('sb.%I', v_provider_col);
  END IF;

  -- ── order_type (محسوب) ──
  IF public.ervenow_col_exists('orders', 'order_type') THEN
    v_insert_cols := v_insert_cols || 'order_type';
    v_select_exprs := v_select_exprs || public.ervenow_sb_order_type_expr(
      v_src_table, v_service_type_col, v_gas_mode_col, v_gas_liters_col
    );
    IF v_service_type_col IS NOT NULL THEN v_used_src_cols := v_used_src_cols || v_service_type_col; END IF;
    IF v_gas_mode_col IS NOT NULL THEN v_used_src_cols := v_used_src_cols || v_gas_mode_col; END IF;
    IF v_gas_liters_col IS NOT NULL THEN v_used_src_cols := v_used_src_cols || v_gas_liters_col; END IF;
  END IF;

  -- ── service_type: service_type ← service_type | service_name ──
  IF public.ervenow_col_exists('orders', 'service_type') THEN
    v_insert_cols := v_insert_cols || 'service_type';
    IF v_service_type_col IS NOT NULL AND v_service_name_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format(
        'coalesce(nullif(trim(sb.%I::text), ''''), nullif(trim(sb.%I::text), ''''), ''service'')',
        v_service_type_col, v_service_name_col
      );
    ELSIF v_service_type_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('coalesce(nullif(trim(sb.%I::text), ''''), ''service'')', v_service_type_col);
    ELSIF v_service_name_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('coalesce(nullif(trim(sb.%I::text), ''''), ''service'')', v_service_name_col);
      v_used_src_cols := v_used_src_cols || v_service_name_col;
    ELSE
      v_select_exprs := v_select_exprs || '''service''::text';
    END IF;
  END IF;

  -- ── service_name ──
  IF public.ervenow_col_exists('orders', 'service_name') THEN
    v_insert_cols := v_insert_cols || 'service_name';
    IF v_service_name_col IS NOT NULL AND v_service_type_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format(
        'coalesce(nullif(trim(sb.%I::text), ''''), nullif(trim(sb.%I::text), ''''))',
        v_service_name_col, v_service_type_col
      );
      v_used_src_cols := v_used_src_cols || v_service_name_col;
    ELSIF v_service_name_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('sb.%I', v_service_name_col);
      v_used_src_cols := v_used_src_cols || v_service_name_col;
    ELSIF v_service_type_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('sb.%I', v_service_type_col);
    ELSE
      v_select_exprs := v_select_exprs || 'NULL::text';
    END IF;
  END IF;

  -- ── delivery_status ← status ──
  IF public.ervenow_col_exists('orders', 'delivery_status') THEN
    v_insert_cols := v_insert_cols || 'delivery_status';
    v_select_exprs := v_select_exprs || public.ervenow_sb_status_expr(v_src_table, v_status_col);
    IF v_status_col IS NOT NULL THEN v_used_src_cols := v_used_src_cols || v_status_col; END IF;
  END IF;

  -- ── order_number ──
  IF public.ervenow_col_exists('orders', 'order_number') THEN
    v_insert_cols := v_insert_cols || 'order_number';
    IF v_order_number_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format(
        $on$coalesce(nullif(trim(sb.%I::text), ''), 'SV-MIG-' || left(sb.id::text, 8))$on$,
        v_order_number_col
      );
      v_used_src_cols := v_used_src_cols || v_order_number_col;
    ELSE
      v_select_exprs := v_select_exprs || $on$'SV-MIG-' || left(sb.id::text, 8)$on$;
    END IF;
  END IF;

  -- ── amounts: total_amount / order_total / platform ──
  IF v_amount_col IS NOT NULL THEN
    IF public.ervenow_col_exists('orders', 'order_total') THEN
      v_insert_cols := v_insert_cols || 'order_total';
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I::numeric, 0)', v_amount_col);
    END IF;
    IF public.ervenow_col_exists('orders', 'total_amount') THEN
      v_insert_cols := v_insert_cols || 'total_amount';
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I::numeric, 0)', v_amount_col);
    END IF;
    v_used_src_cols := v_used_src_cols || v_amount_col;
  ELSE
    IF public.ervenow_col_exists('orders', 'order_total') THEN
      v_insert_cols := v_insert_cols || 'order_total';
      v_select_exprs := v_select_exprs || '0::numeric';
    END IF;
    IF public.ervenow_col_exists('orders', 'total_amount') THEN
      v_insert_cols := v_insert_cols || 'total_amount';
      v_select_exprs := v_select_exprs || '0::numeric';
    END IF;
  END IF;

  IF v_commission_col IS NOT NULL THEN
    IF public.ervenow_col_exists('orders', 'platform_commission') THEN
      v_insert_cols := v_insert_cols || 'platform_commission';
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I::numeric, 0)', v_commission_col);
    END IF;
    IF public.ervenow_col_exists('orders', 'platform_fee') THEN
      v_insert_cols := v_insert_cols || 'platform_fee';
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I::numeric, 0)', v_commission_col);
    END IF;
    v_used_src_cols := v_used_src_cols || v_commission_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'payment_status') AND v_payment_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'payment_status';
    v_select_exprs := v_select_exprs || format('coalesce(sb.%I::text, ''unpaid'')', v_payment_col);
    v_used_src_cols := v_used_src_cols || v_payment_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'district') AND v_district_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'district';
    v_select_exprs := v_select_exprs || format('sb.%I', v_district_col);
    v_used_src_cols := v_used_src_cols || v_district_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'service_location') AND v_location_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'service_location';
    v_select_exprs := v_select_exprs || format('sb.%I', v_location_col);
    v_used_src_cols := v_used_src_cols || v_location_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'drop_address') AND v_location_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'drop_address';
    v_select_exprs := v_select_exprs || format('coalesce(sb.%I::text, ''موقع الخدمة'')', v_location_col);
  END IF;

  IF public.ervenow_col_exists('orders', 'service_qty') AND v_qty_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'service_qty';
    v_select_exprs := v_select_exprs || format('coalesce(sb.%I::integer, 1)', v_qty_col);
    v_used_src_cols := v_used_src_cols || v_qty_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'gas_mode') AND v_gas_mode_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'gas_mode';
    v_select_exprs := v_select_exprs || format('sb.%I', v_gas_mode_col);
  END IF;

  IF public.ervenow_col_exists('orders', 'gas_liters') AND v_gas_liters_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'gas_liters';
    v_select_exprs := v_select_exprs || format('sb.%I', v_gas_liters_col);
  END IF;

  IF public.ervenow_col_exists('orders', 'notes') AND v_notes_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'notes';
    v_select_exprs := v_select_exprs || format('sb.%I', v_notes_col);
    v_used_src_cols := v_used_src_cols || v_notes_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'scheduled_at') AND v_scheduled_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'scheduled_at';
    v_select_exprs := v_select_exprs || format('sb.%I', v_scheduled_col);
    v_used_src_cols := v_used_src_cols || v_scheduled_col;
  END IF;

  IF v_rating_col IS NOT NULL THEN
    IF public.ervenow_col_exists('orders', 'service_rating') THEN
      v_insert_cols := v_insert_cols || 'service_rating';
      v_select_exprs := v_select_exprs || format('sb.%I', v_rating_col);
    END IF;
    IF public.ervenow_col_exists('orders', 'rating') THEN
      v_insert_cols := v_insert_cols || 'rating';
      v_select_exprs := v_select_exprs || format('sb.%I', v_rating_col);
    END IF;
    v_used_src_cols := v_used_src_cols || v_rating_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'service_review') AND v_review_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'service_review';
    v_select_exprs := v_select_exprs || format('sb.%I', v_review_col);
    v_used_src_cols := v_used_src_cols || v_review_col;
  ELSIF public.ervenow_col_exists('orders', 'review') AND v_review_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'review';
    v_select_exprs := v_select_exprs || format('sb.%I', v_review_col);
    v_used_src_cols := v_used_src_cols || v_review_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'service_rated_at') AND v_rated_at_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'service_rated_at';
    v_select_exprs := v_select_exprs || format('sb.%I', v_rated_at_col);
    v_used_src_cols := v_used_src_cols || v_rated_at_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'provider_completed_at') AND v_provider_done_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'provider_completed_at';
    v_select_exprs := v_select_exprs || format('sb.%I', v_provider_done_col);
    v_used_src_cols := v_used_src_cols || v_provider_done_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'customer_confirmed_at') AND v_customer_done_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'customer_confirmed_at';
    v_select_exprs := v_select_exprs || format('sb.%I', v_customer_done_col);
    v_used_src_cols := v_used_src_cols || v_customer_done_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'commission_settled') AND v_comm_settled_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'commission_settled';
    v_select_exprs := v_select_exprs || format('coalesce(sb.%I, false)', v_comm_settled_col);
    v_used_src_cols := v_used_src_cols || v_comm_settled_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'commission_due') AND v_comm_due_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'commission_due';
    v_select_exprs := v_select_exprs || format('coalesce(sb.%I, false)', v_comm_due_col);
    v_used_src_cols := v_used_src_cols || v_comm_due_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'commission_paid_at') AND v_comm_paid_col IS NOT NULL THEN
    v_insert_cols := v_insert_cols || 'commission_paid_at';
    v_select_exprs := v_select_exprs || format('sb.%I', v_comm_paid_col);
    v_used_src_cols := v_used_src_cols || v_comm_paid_col;
  END IF;

  IF public.ervenow_col_exists('orders', 'created_at') THEN
    v_insert_cols := v_insert_cols || 'created_at';
    IF v_created_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I, now())', v_created_col);
      v_used_src_cols := v_used_src_cols || v_created_col;
    ELSE
      v_select_exprs := v_select_exprs || 'now()';
    END IF;
  END IF;

  IF public.ervenow_col_exists('orders', 'updated_at') THEN
    v_insert_cols := v_insert_cols || 'updated_at';
    IF v_updated_col IS NOT NULL AND v_created_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I, sb.%I, now())', v_updated_col, v_created_col);
      v_used_src_cols := v_used_src_cols || v_updated_col;
    ELSIF v_updated_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I, now())', v_updated_col);
      v_used_src_cols := v_used_src_cols || v_updated_col;
    ELSIF v_created_col IS NOT NULL THEN
      v_select_exprs := v_select_exprs || format('coalesce(sb.%I, now())', v_created_col);
    ELSE
      v_select_exprs := v_select_exprs || 'now()';
    END IF;
  END IF;

  -- ── data jsonb: أي عمود مصدر لم يُستخدم ──
  IF public.ervenow_col_exists('orders', 'data') THEN
    v_data_expr := public.ervenow_sb_extra_data_expr(v_src_table, v_used_src_cols);
    v_insert_cols := v_insert_cols || 'data';
    v_select_exprs := v_select_exprs || v_data_expr;
    IF public.ervenow_col_exists(v_src_table, 'data') THEN
      v_used_src_cols := v_used_src_cols || 'data';
    END IF;
  END IF;

  -- ── تخطّي الصفوف بدون customer_id إذا كان إلزامياً ──
  IF v_customer_required AND public.ervenow_col_exists('orders', 'customer_id') THEN
    EXECUTE format(
      $sk$INSERT INTO public.ervenow_migration_skipped_rows (id, source_table, reason, row_snapshot)
      SELECT sb.id, %L, 'missing_customer_id',
        to_jsonb(sb.*) - 'id'
      FROM public.%I sb
      WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id)
        AND NOT (
          %s IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE %s
          )
        )$sk$,
      v_src_table,
      v_src_table,
      CASE WHEN v_customer_id_col IS NOT NULL THEN format('sb.%I', v_customer_id_col) ELSE 'NULL::uuid' END,
      CASE
        WHEN v_customer_phone_col IS NOT NULL THEN
          format(
            $ph$regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(sb.%I::text, ''), '\D', '', 'g')
              AND regexp_replace(coalesce(sb.%I::text, ''), '\D', '', 'g') <> ''$ph$,
            v_customer_phone_col, v_customer_phone_col
          )
        ELSE 'false'
      END
    );
    GET DIAGNOSTICS v_skipped = ROW_COUNT;
  END IF;

  -- ── INSERT ──
  v_sql := format(
    $ins$INSERT INTO public.orders (%s)
    SELECT %s
    FROM public.%I sb
    WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id)
    %s$ins$,
    array_to_string(v_insert_cols, ', '),
    array_to_string(v_select_exprs, ', '),
    v_src_table,
    CASE
      WHEN v_customer_required AND public.ervenow_col_exists('orders', 'customer_id') THEN
        format(
          $w$AND (
            %s IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM public.users u
              WHERE %s
            )
          )$w$,
          CASE WHEN v_customer_id_col IS NOT NULL THEN format('sb.%I', v_customer_id_col) ELSE 'NULL::uuid' END,
          CASE
            WHEN v_customer_phone_col IS NOT NULL THEN
              format(
                $ph$regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(sb.%I::text, ''), '\D', '', 'g')
                  AND regexp_replace(coalesce(sb.%I::text, ''), '\D', '', 'g') <> ''$ph$,
                v_customer_phone_col, v_customer_phone_col
              )
            ELSE 'false'
          END
        )
      ELSE ''
    END
  );

  RAISE NOTICE '[ervenow_smart_migrate] source=% insert_cols=%', v_src_table, v_insert_cols;
  EXECUTE v_sql;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  v_report := jsonb_build_object(
    'ok', true,
    'source_table', v_src_table,
    'rows_inserted', v_inserted,
    'rows_skipped_missing_customer', v_skipped,
    'discovered_columns', jsonb_build_object(
      'status', v_status_col,
      'amount', v_amount_col,
      'service_type', v_service_type_col,
      'service_name', v_service_name_col,
      'order_number', v_order_number_col,
      'customer_id', v_customer_id_col,
      'customer_phone', v_customer_phone_col,
      'provider', v_provider_col,
      'location', v_location_col,
      'qty', v_qty_col,
      'payment', v_payment_col,
      'commission', v_commission_col,
      'gas_mode', v_gas_mode_col,
      'gas_liters', v_gas_liters_col,
      'district', v_district_col,
      'notes', v_notes_col,
      'scheduled', v_scheduled_col,
      'rating', v_rating_col,
      'review', v_review_col,
      'rated_at', v_rated_at_col,
      'provider_completed_at', v_provider_done_col,
      'customer_confirmed_at', v_customer_done_col,
      'commission_settled', v_comm_settled_col,
      'commission_due', v_comm_due_col,
      'commission_paid_at', v_comm_paid_col,
      'created_at', v_created_col,
      'updated_at', v_updated_col
    ),
    'orders_columns_written', to_jsonb(v_insert_cols),
    'generated_sql_preview', left(v_sql, 4000)
  );

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_smart_migrate_service_bookings_report()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_src text;
  v_src_count bigint := 0;
  v_orders_count bigint := 0;
  v_skipped_count bigint := 0;
BEGIN
  IF public.ervenow_table_exists('service_bookings') THEN
    v_src := 'service_bookings';
  ELSIF public.ervenow_table_exists('service_bookings_legacy') THEN
    v_src := 'service_bookings_legacy';
  ELSE
    v_src := NULL;
  END IF;

  IF v_src IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I', v_src) INTO v_src_count;
  END IF;

  SELECT count(*) INTO v_orders_count
  FROM public.orders
  WHERE order_type IN ('service', 'gas_delivery');

  SELECT count(*) INTO v_skipped_count
  FROM public.ervenow_migration_skipped_rows
  WHERE source_table = coalesce(v_src, 'unknown');

  RETURN jsonb_build_object(
    'source_table', v_src,
    'source_rows', v_src_count,
    'orders_service_rows', v_orders_count,
    'skipped_rows_logged', v_skipped_count,
    'parity_ok', (v_src IS NULL OR v_orders_count >= v_src_count - v_skipped_count)
  );
END;
$$;

-- ─── 5) تنفيذ النقل ───────────────────────────────────────────────────────
SELECT public.ervenow_smart_migrate_service_bookings() AS migration_result;

-- ─── 6) RPC ledger — يقرأ orders ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ervenow_ledger_settle_service_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  wid_platform uuid;
  wid_provider uuid;
  v_comm numeric(14, 2);
  v_ref text;
  r_platform jsonb;
  r_provider jsonb;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_booking_id');
  END IF;

  SELECT * INTO b
  FROM public.orders
  WHERE id = p_booking_id
    AND order_type IN ('service', 'gas_delivery')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  END IF;

  IF lower(coalesce(b.delivery_status, '')) NOT IN ('delivered', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  IF coalesce(b.provider_id, b.service_provider_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_provider');
  END IF;

  v_comm := round(coalesce(b.platform_commission, b.platform_fee, b.total_amount, 0)::numeric * 0.07, 2);
  IF v_comm <= 0 THEN
    v_comm := round(coalesce(b.platform_commission, b.platform_fee, 0)::numeric, 2);
  END IF;
  IF v_comm <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'skip_zero');
  END IF;

  v_ref := 'booking:' || p_booking_id::text || ':service_commission';

  IF EXISTS (
    SELECT 1 FROM public.ervenow_ledger_transactions t
    WHERE t.reference_id = v_ref AND t.status = 'completed'
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate', 'commission', v_comm);
  END IF;

  SELECT w.id INTO wid_platform FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true LIMIT 1;
  IF wid_platform IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  END IF;

  wid_provider := public.ervenow_ledger_ensure_wallet(coalesce(b.provider_id, b.service_provider_id), 'service');

  r_platform := public.ervenow_ledger_append_completed(wid_platform, 'commission', 'credit', v_comm, v_ref, 'عمولة منصة — خدمة');
  r_provider := public.ervenow_ledger_append_completed(wid_provider, 'commission', 'debit', v_comm, v_ref, 'عمولة منصة — خدمة');

  UPDATE public.orders
  SET commission_settled = true, commission_due = false, updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('ok', true, 'commission', v_comm, 'platform', r_platform, 'provider', r_provider);
END;
$$;

-- ─── 7) أرشفة + منع الكتابة ───────────────────────────────────────────────
DO $$
BEGIN
  IF public.ervenow_table_exists('service_bookings')
     AND NOT public.ervenow_table_exists('service_bookings_legacy') THEN
    ALTER TABLE public.service_bookings RENAME TO service_bookings_legacy;
  END IF;
END $$;

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
  IF public.ervenow_table_exists('service_bookings_legacy') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS prevent_service_bookings_write ON public.service_bookings_legacy';
    EXECUTE $trg$
      CREATE TRIGGER prevent_service_bookings_write
        BEFORE INSERT OR UPDATE OR DELETE ON public.service_bookings_legacy
        FOR EACH ROW EXECUTE FUNCTION public.block_service_bookings_legacy()
    $trg$;
    RAISE NOTICE '[ervenow] trigger enabled on service_bookings_legacy';
  ELSE
    RAISE NOTICE '[ervenow] skip trigger — service_bookings_legacy not found (rename pending or merge complete)';
  END IF;
END $$;

-- ─── 8) تقرير نهائي ───────────────────────────────────────────────────────
SELECT public.ervenow_smart_migrate_service_bookings_report() AS final_report;

NOTIFY pgrst, 'reload schema';
