-- =============================================================================
-- ERVENOW — تشخيص كامل لـ service_bookings قبل أي migration
-- =============================================================================
-- نفّذ في Supabase → SQL Editor (Run كاملاً).
-- لا يعدّل البيانات — قراءة + تقرير + توليد SQL جاهز.
-- =============================================================================

-- ─── 1) أي جدول موجود؟ ─────────────────────────────────────────────────────
SELECT
  to_regclass('public.service_bookings')        AS service_bookings,
  to_regclass('public.service_bookings_legacy') AS service_bookings_legacy,
  to_regclass('public.orders')                  AS orders;

-- ─── 2) schema كامل (الجدول الفعلي) ────────────────────────────────────────
WITH src AS (
  SELECT CASE
    WHEN to_regclass('public.service_bookings') IS NOT NULL THEN 'service_bookings'
    WHEN to_regclass('public.service_bookings_legacy') IS NOT NULL THEN 'service_bookings_legacy'
    ELSE NULL
  END AS table_name
)
SELECT
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.ordinal_position
FROM information_schema.columns c
JOIN src ON src.table_name IS NOT NULL AND c.table_name = src.table_name
WHERE c.table_schema = 'public'
ORDER BY c.ordinal_position;

-- ─── 3) عدّ الصفوف + حالة orders ───────────────────────────────────────────
SELECT
  CASE
    WHEN to_regclass('public.service_bookings') IS NOT NULL
      THEN (SELECT count(*)::bigint FROM public.service_bookings)
    WHEN to_regclass('public.service_bookings_legacy') IS NOT NULL
      THEN (SELECT count(*)::bigint FROM public.service_bookings_legacy)
    ELSE 0
  END AS source_rows,
  (SELECT count(*)::bigint FROM public.orders WHERE order_type IN ('service', 'gas_delivery')) AS orders_service_rows,
  (SELECT count(*)::bigint FROM public.orders o
   WHERE to_regclass('public.service_bookings') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.service_bookings sb WHERE sb.id = o.id)
  ) AS already_in_orders_overlap;

-- ─── 4) عينة بيانات (5 صفوف) ───────────────────────────────────────────────
DO $$
DECLARE
  v_tbl text;
BEGIN
  IF to_regclass('public.service_bookings') IS NOT NULL THEN
    v_tbl := 'service_bookings';
  ELSIF to_regclass('public.service_bookings_legacy') IS NOT NULL THEN
    v_tbl := 'service_bookings_legacy';
  ELSE
    RAISE NOTICE 'لا يوجد service_bookings ولا service_bookings_legacy';
    RETURN;
  END IF;
  RAISE NOTICE '=== SAMPLE FROM % (run manually): SELECT * FROM public.% LIMIT 5;', v_tbl, v_tbl;
END $$;

-- نفّذ يدوياً حسب الجدول الموجود:
-- SELECT * FROM service_bookings LIMIT 5;
-- SELECT * FROM service_bookings_legacy LIMIT 5;

-- ─── 5) دالة: اكتشاف الأعمدة + mapping + توليد SQL ───────────────────────

CREATE OR REPLACE FUNCTION public.ervenow_pick_src_col(
  p_table text,
  p_candidates text[]
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY p_candidates LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table AND column_name = c
    ) THEN
      RETURN c;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_diagnose_service_bookings_schema()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_src text;
  v_cols jsonb;
  v_mapping jsonb;
  v_orders_ok jsonb;
  v_generated_sql text;
  -- discovered source columns
  c_id text := 'id';
  c_customer_id text;
  c_customer_phone text;
  c_provider text;
  c_service_type text;
  c_service_name text;
  c_status text;
  c_amount text;
  c_order_number text;
  c_location text;
  c_district text;
  c_qty text;
  c_payment text;
  c_commission text;
  c_gas_mode text;
  c_gas_liters text;
  c_notes text;
  c_lat text;
  c_lng text;
  c_scheduled text;
  c_rating text;
  c_review text;
  c_rated_at text;
  c_provider_done text;
  c_customer_done text;
  c_comm_settled text;
  c_comm_due text;
  c_comm_paid text;
  c_created text;
  c_updated text;
  c_reserved text;
  -- insert parts
  ins_cols text[] := ARRAY[]::text[];
  sel_exprs text[] := ARRAY[]::text[];
  used_src text[] := ARRAY[]::text[];
  extra_cols jsonb := '[]'::jsonb;
  col record;
BEGIN
  IF to_regclass('public.service_bookings') IS NOT NULL THEN
    v_src := 'service_bookings';
  ELSIF to_regclass('public.service_bookings_legacy') IS NOT NULL THEN
    v_src := 'service_bookings_legacy';
  ELSE
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'no_source_table',
      'hint', 'Neither service_bookings nor service_bookings_legacy exists'
    );
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'column_name', column_name,
      'data_type', data_type,
      'udt_name', udt_name,
      'is_nullable', is_nullable,
      'column_default', column_default
    ) ORDER BY ordinal_position
  ), '[]'::jsonb)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = v_src;

  -- semantic discovery
  c_customer_id    := public.ervenow_pick_src_col(v_src, ARRAY['customer_id','user_id','client_id']);
  c_customer_phone := public.ervenow_pick_src_col(v_src, ARRAY['customer_phone','phone','mobile']);
  c_provider       := public.ervenow_pick_src_col(v_src, ARRAY['provider_id','service_provider_id','worker_id']);
  c_service_type   := public.ervenow_pick_src_col(v_src, ARRAY['service_type','type','category']);
  c_service_name   := public.ervenow_pick_src_col(v_src, ARRAY['service_name','title','name']);
  c_status         := public.ervenow_pick_src_col(v_src, ARRAY['status','delivery_status','state','booking_status']);
  c_amount         := public.ervenow_pick_src_col(v_src, ARRAY['total_amount','total','price','amount','order_total']);
  c_order_number   := public.ervenow_pick_src_col(v_src, ARRAY['service_order_number','order_number','booking_number']);
  c_location       := public.ervenow_pick_src_col(v_src, ARRAY['location','service_location','address','drop_address']);
  c_district       := public.ervenow_pick_src_col(v_src, ARRAY['district','area','neighborhood']);
  c_qty            := public.ervenow_pick_src_col(v_src, ARRAY['qty','quantity','service_qty']);
  c_payment        := public.ervenow_pick_src_col(v_src, ARRAY['payment_status','pay_status']);
  c_commission     := public.ervenow_pick_src_col(v_src, ARRAY['platform_commission','commission','platform_fee']);
  c_gas_mode       := public.ervenow_pick_src_col(v_src, ARRAY['gas_mode','gas_type']);
  c_gas_liters     := public.ervenow_pick_src_col(v_src, ARRAY['gas_liters','liters']);
  c_notes          := public.ervenow_pick_src_col(v_src, ARRAY['notes','description','comment']);
  c_lat            := public.ervenow_pick_src_col(v_src, ARRAY['lat','drop_lat','latitude']);
  c_lng            := public.ervenow_pick_src_col(v_src, ARRAY['lng','drop_lng','longitude']);
  c_scheduled      := public.ervenow_pick_src_col(v_src, ARRAY['scheduled_at','scheduled_for','appointment_at']);
  c_rating         := public.ervenow_pick_src_col(v_src, ARRAY['rating','service_rating']);
  c_review         := public.ervenow_pick_src_col(v_src, ARRAY['review','service_review','feedback']);
  c_rated_at       := public.ervenow_pick_src_col(v_src, ARRAY['rated_at','service_rated_at']);
  c_provider_done  := public.ervenow_pick_src_col(v_src, ARRAY['provider_completed_at']);
  c_customer_done  := public.ervenow_pick_src_col(v_src, ARRAY['customer_confirmed_at']);
  c_comm_settled   := public.ervenow_pick_src_col(v_src, ARRAY['commission_settled']);
  c_comm_due       := public.ervenow_pick_src_col(v_src, ARRAY['commission_due']);
  c_comm_paid      := public.ervenow_pick_src_col(v_src, ARRAY['commission_paid_at']);
  c_created        := public.ervenow_pick_src_col(v_src, ARRAY['created_at']);
  c_updated        := public.ervenow_pick_src_col(v_src, ARRAY['updated_at']);
  c_reserved       := public.ervenow_pick_src_col(v_src, ARRAY['reserved_at']);

  v_mapping := jsonb_build_object(
    'source_table', v_src,
    'id', coalesce(c_id, null),
    'customer_id', c_customer_id,
    'customer_phone', c_customer_phone,
    'provider_id', c_provider,
    'service_type', c_service_type,
    'service_name', c_service_name,
    'status', c_status,
    'amount', c_amount,
    'order_number', c_order_number,
    'location', c_location,
    'district', c_district,
    'qty', c_qty,
    'payment_status', c_payment,
    'platform_commission', c_commission,
    'gas_mode', c_gas_mode,
    'gas_liters', c_gas_liters,
    'notes', c_notes,
    'lat', c_lat,
    'lng', c_lng,
    'scheduled_at', c_scheduled,
    'rating', c_rating,
    'review', c_review,
    'rated_at', c_rated_at,
    'provider_completed_at', c_provider_done,
    'customer_confirmed_at', c_customer_done,
    'commission_settled', c_comm_settled,
    'commission_due', c_comm_due,
    'commission_paid_at', c_comm_paid,
    'created_at', c_created,
    'updated_at', c_updated,
    'reserved_at', c_reserved,
    'orders_target', jsonb_build_object(
      'id → id', true,
      'customer_id → customer_id', c_customer_id IS NOT NULL,
      'customer_phone → customer_phone', c_customer_phone IS NOT NULL,
      'provider_id → provider_id + service_provider_id', c_provider IS NOT NULL,
      'service_type → service_type', c_service_type IS NOT NULL OR c_service_name IS NOT NULL,
      'service_name → service_name', c_service_name IS NOT NULL OR c_service_type IS NOT NULL,
      'status → delivery_status', c_status IS NOT NULL,
      'amount → total_amount + order_total', c_amount IS NOT NULL,
      'order_number → order_number', c_order_number IS NOT NULL,
      'location → service_location + drop_address', c_location IS NOT NULL,
      'district → district', c_district IS NOT NULL,
      'qty → service_qty', c_qty IS NOT NULL,
      'payment → payment_status', c_payment IS NOT NULL,
      'commission → platform_commission + platform_fee', c_commission IS NOT NULL,
      'gas_mode → gas_mode', c_gas_mode IS NOT NULL,
      'gas_liters → gas_liters', c_gas_liters IS NOT NULL,
      'rating → service_rating + rating', c_rating IS NOT NULL,
      'review → service_review / review', c_review IS NOT NULL,
      'unmapped_source_columns → orders.data (jsonb)', true
    )
  );

  -- ── build INSERT only from columns that EXIST on source AND target ──
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=v_src AND column_name='id') THEN
    ins_cols := ins_cols || 'id';
    sel_exprs := sel_exprs || 'sb.id';
    used_src := used_src || 'id';
  END IF;

  IF c_customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='customer_id') THEN
    ins_cols := ins_cols || 'customer_id';
    sel_exprs := sel_exprs || format('sb.%I', c_customer_id);
    used_src := used_src || c_customer_id;
  END IF;

  IF c_customer_phone IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='customer_phone') THEN
    ins_cols := ins_cols || 'customer_phone';
    sel_exprs := sel_exprs || format('sb.%I', c_customer_phone);
    used_src := used_src || c_customer_phone;
  END IF;

  IF c_provider IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='provider_id') THEN
      ins_cols := ins_cols || 'provider_id';
      sel_exprs := sel_exprs || format('sb.%I', c_provider);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_provider_id') THEN
      ins_cols := ins_cols || 'service_provider_id';
      sel_exprs := sel_exprs || format('sb.%I', c_provider);
    END IF;
    used_src := used_src || c_provider;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='order_type') THEN
    ins_cols := ins_cols || 'order_type';
    IF c_gas_mode IS NOT NULL OR c_gas_liters IS NOT NULL OR c_service_type IS NOT NULL THEN
      sel_exprs := sel_exprs || format(
        $ot$CASE WHEN %s OR %s OR %s THEN 'gas_delivery' ELSE 'service' END$ot$,
        CASE WHEN c_gas_mode IS NOT NULL THEN format('sb.%I IS NOT NULL', c_gas_mode) ELSE 'false' END,
        CASE WHEN c_gas_liters IS NOT NULL THEN format('sb.%I IS NOT NULL', c_gas_liters) ELSE 'false' END,
        CASE WHEN c_service_type IS NOT NULL THEN format($t$lower(coalesce(sb.%I::text,'')) IN ('gas_delivery','gas')$t$, c_service_type) ELSE 'false' END
      );
    ELSE
      sel_exprs := sel_exprs || '''service''::text';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_type') THEN
    ins_cols := ins_cols || 'service_type';
    IF c_service_type IS NOT NULL AND c_service_name IS NOT NULL THEN
      sel_exprs := sel_exprs || format('coalesce(nullif(trim(sb.%I::text),''''), nullif(trim(sb.%I::text),''''), ''service'')', c_service_type, c_service_name);
      used_src := array_append(used_src, c_service_type);
      used_src := array_append(used_src, c_service_name);
    ELSIF c_service_type IS NOT NULL THEN
      sel_exprs := sel_exprs || format('coalesce(nullif(trim(sb.%I::text),''''), ''service'')', c_service_type);
      used_src := array_append(used_src, c_service_type);
    ELSIF c_service_name IS NOT NULL THEN
      sel_exprs := sel_exprs || format('coalesce(nullif(trim(sb.%I::text),''''), ''service'')', c_service_name);
      used_src := array_append(used_src, c_service_name);
    ELSE
      sel_exprs := sel_exprs || '''service''::text';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_name') THEN
    ins_cols := ins_cols || 'service_name';
    IF c_service_name IS NOT NULL THEN
      sel_exprs := sel_exprs || format('sb.%I', c_service_name);
      used_src := used_src || c_service_name;
    ELSIF c_service_type IS NOT NULL THEN
      sel_exprs := sel_exprs || format('sb.%I', c_service_type);
    ELSE
      sel_exprs := sel_exprs || 'NULL::text';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='delivery_status') THEN
    ins_cols := ins_cols || 'delivery_status';
    IF c_status IS NOT NULL THEN
      sel_exprs := sel_exprs || format(
        $st$CASE lower(trim(coalesce(sb.%I::text, 'pending')))
          WHEN 'completed' THEN 'delivered'
          WHEN 'cancelled' THEN 'cancelled'
          WHEN 'canceled' THEN 'cancelled'
          WHEN 'delivered' THEN 'delivered'
          WHEN 'accepted' THEN 'accepted'
          WHEN 'delivering' THEN 'delivering'
          WHEN 'new' THEN 'pending'
          ELSE 'pending' END$st$,
        c_status
      );
      used_src := used_src || c_status;
    ELSE
      sel_exprs := sel_exprs || '''pending''::text';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='order_number') THEN
    ins_cols := ins_cols || 'order_number';
    IF c_order_number IS NOT NULL THEN
      sel_exprs := sel_exprs || format($n$coalesce(nullif(trim(sb.%I::text), ''), 'SV-MIG-' || left(sb.id::text, 8))$n$, c_order_number);
      used_src := used_src || c_order_number;
    ELSE
      sel_exprs := sel_exprs || $n$'SV-MIG-' || left(sb.id::text, 8)$n$;
    END IF;
  END IF;

  IF c_amount IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='total_amount') THEN
      ins_cols := ins_cols || 'total_amount';
      sel_exprs := sel_exprs || format('coalesce(sb.%I::numeric, 0)', c_amount);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='order_total') THEN
      ins_cols := ins_cols || 'order_total';
      sel_exprs := sel_exprs || format('coalesce(sb.%I::numeric, 0)', c_amount);
    END IF;
    used_src := used_src || c_amount;
  END IF;

  IF c_commission IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='platform_commission') THEN
      ins_cols := ins_cols || 'platform_commission';
      sel_exprs := sel_exprs || format('coalesce(sb.%I::numeric, 0)', c_commission);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='platform_fee') THEN
      ins_cols := ins_cols || 'platform_fee';
      sel_exprs := sel_exprs || format('coalesce(sb.%I::numeric, 0)', c_commission);
    END IF;
    used_src := used_src || c_commission;
  END IF;

  IF c_payment IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payment_status') THEN
    ins_cols := ins_cols || 'payment_status';
    sel_exprs := sel_exprs || format('coalesce(sb.%I::text, ''unpaid'')', c_payment);
    used_src := used_src || c_payment;
  END IF;

  IF c_district IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='district') THEN
    ins_cols := ins_cols || 'district';
    sel_exprs := sel_exprs || format('sb.%I', c_district);
    used_src := used_src || c_district;
  END IF;

  IF c_location IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_location') THEN
      ins_cols := ins_cols || 'service_location';
      sel_exprs := sel_exprs || format('sb.%I', c_location);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='drop_address') THEN
      ins_cols := ins_cols || 'drop_address';
      sel_exprs := sel_exprs || format('coalesce(sb.%I::text, ''موقع الخدمة'')', c_location);
    END IF;
    used_src := used_src || c_location;
  END IF;

  IF c_qty IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_qty') THEN
    ins_cols := ins_cols || 'service_qty';
    sel_exprs := sel_exprs || format('coalesce(sb.%I::integer, 1)', c_qty);
    used_src := used_src || c_qty;
  END IF;

  IF c_gas_mode IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='gas_mode') THEN
    ins_cols := ins_cols || 'gas_mode';
    sel_exprs := sel_exprs || format('sb.%I', c_gas_mode);
    used_src := used_src || c_gas_mode;
  END IF;

  IF c_gas_liters IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='gas_liters') THEN
    ins_cols := ins_cols || 'gas_liters';
    sel_exprs := sel_exprs || format('sb.%I', c_gas_liters);
    used_src := used_src || c_gas_liters;
  END IF;

  IF c_notes IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='notes') THEN
    ins_cols := ins_cols || 'notes';
    sel_exprs := sel_exprs || format('sb.%I', c_notes);
    used_src := used_src || c_notes;
  END IF;

  IF c_lat IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='drop_lat') THEN
    ins_cols := ins_cols || 'drop_lat';
    sel_exprs := sel_exprs || format('sb.%I::numeric', c_lat);
    used_src := used_src || c_lat;
  END IF;

  IF c_lng IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='drop_lng') THEN
    ins_cols := ins_cols || 'drop_lng';
    sel_exprs := sel_exprs || format('sb.%I::numeric', c_lng);
    used_src := used_src || c_lng;
  END IF;

  IF c_scheduled IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='scheduled_at') THEN
    ins_cols := ins_cols || 'scheduled_at';
    sel_exprs := sel_exprs || format('sb.%I', c_scheduled);
    used_src := used_src || c_scheduled;
  END IF;

  IF c_rating IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_rating') THEN
      ins_cols := ins_cols || 'service_rating';
      sel_exprs := sel_exprs || format('sb.%I', c_rating);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='rating') THEN
      ins_cols := ins_cols || 'rating';
      sel_exprs := sel_exprs || format('sb.%I', c_rating);
    END IF;
    used_src := used_src || c_rating;
  END IF;

  IF c_review IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_review') THEN
      ins_cols := ins_cols || 'service_review';
      sel_exprs := sel_exprs || format('sb.%I', c_review);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='review') THEN
      ins_cols := ins_cols || 'review';
      sel_exprs := sel_exprs || format('sb.%I', c_review);
    END IF;
    used_src := used_src || c_review;
  END IF;

  IF c_rated_at IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='service_rated_at') THEN
    ins_cols := ins_cols || 'service_rated_at';
    sel_exprs := sel_exprs || format('sb.%I', c_rated_at);
    used_src := used_src || c_rated_at;
  END IF;

  IF c_provider_done IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='provider_completed_at') THEN
    ins_cols := ins_cols || 'provider_completed_at';
    sel_exprs := sel_exprs || format('sb.%I', c_provider_done);
    used_src := used_src || c_provider_done;
  END IF;

  IF c_customer_done IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='customer_confirmed_at') THEN
    ins_cols := ins_cols || 'customer_confirmed_at';
    sel_exprs := sel_exprs || format('sb.%I', c_customer_done);
    used_src := used_src || c_customer_done;
  END IF;

  IF c_comm_settled IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='commission_settled') THEN
    ins_cols := ins_cols || 'commission_settled';
    sel_exprs := sel_exprs || format('coalesce(sb.%I, false)', c_comm_settled);
    used_src := used_src || c_comm_settled;
  END IF;

  IF c_comm_due IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='commission_due') THEN
    ins_cols := ins_cols || 'commission_due';
    sel_exprs := sel_exprs || format('coalesce(sb.%I, false)', c_comm_due);
    used_src := used_src || c_comm_due;
  END IF;

  IF c_comm_paid IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='commission_paid_at') THEN
    ins_cols := ins_cols || 'commission_paid_at';
    sel_exprs := sel_exprs || format('sb.%I', c_comm_paid);
    used_src := used_src || c_comm_paid;
  END IF;

  IF c_created IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='created_at') THEN
    ins_cols := ins_cols || 'created_at';
    sel_exprs := sel_exprs || format('coalesce(sb.%I, now())', c_created);
    used_src := used_src || c_created;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='updated_at') THEN
    ins_cols := ins_cols || 'updated_at';
    IF c_updated IS NOT NULL AND c_created IS NOT NULL THEN
      sel_exprs := sel_exprs || format('coalesce(sb.%I, sb.%I, now())', c_updated, c_created);
      used_src := used_src || c_updated;
    ELSIF c_updated IS NOT NULL THEN
      sel_exprs := sel_exprs || format('coalesce(sb.%I, now())', c_updated);
      used_src := used_src || c_updated;
    ELSIF c_created IS NOT NULL THEN
      sel_exprs := sel_exprs || format('coalesce(sb.%I, now())', c_created);
    ELSE
      sel_exprs := sel_exprs || 'now()';
    END IF;
  END IF;

  -- extra columns → data jsonb
  FOR col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_src
      AND column_name <> ALL (used_src)
      AND column_name <> 'data'
    ORDER BY ordinal_position
  LOOP
    extra_cols := extra_cols || to_jsonb(col.column_name);
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='data')
     AND jsonb_array_length(extra_cols) > 0 THEN
    ins_cols := ins_cols || 'data';
    sel_exprs := sel_exprs || format(
      $d$coalesce(
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=%L AND column_name='data') THEN sb.data ELSE NULL END,
        '{}'::jsonb
      ) || jsonb_build_object('migrated_from', %L, 'migrated_at', now())$d$,
      v_src, v_src
    );
    -- append extra fields dynamically would need another loop; keep in mapping report
  END IF;

  IF array_length(ins_cols, 1) IS NULL OR array_length(ins_cols, 1) = 0 THEN
    v_generated_sql := '-- ERROR: no mappable columns between ' || v_src || ' and orders';
  ELSE
    v_generated_sql := format(
      E'-- Generated from information_schema — source: %s\n-- Review before running\n\nINSERT INTO public.orders (%s)\nSELECT\n  %s\nFROM public.%I sb\nWHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id);',
      v_src,
      array_to_string(ins_cols, ', '),
      array_to_string(sel_exprs, E',\n  '),
      v_src
    );
  END IF;

  -- orders columns check
  SELECT coalesce(jsonb_object_agg(column_name, data_type), '{}'::jsonb)
  INTO v_orders_ok
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name = ANY (ins_cols);

  RETURN jsonb_build_object(
    'ok', true,
    'source_table', v_src,
    'source_columns', v_cols,
    'semantic_mapping', v_mapping,
    'orders_columns_used', to_jsonb(ins_cols),
    'unmapped_source_columns', extra_cols,
    'missing_critical', jsonb_build_object(
      'customer_id', c_customer_id IS NULL,
      'status', c_status IS NULL,
      'amount', c_amount IS NULL,
      'service_identity', c_service_type IS NULL AND c_service_name IS NULL
    ),
    'generated_insert_sql', v_generated_sql
  );
END;
$$;

-- ─── 6) التقرير الكامل ─────────────────────────────────────────────────────
SELECT jsonb_pretty(public.ervenow_diagnose_service_bookings_schema()) AS full_diagnosis;

-- ─── 7) استخراج SQL جاهز فقط (انسخه) ───────────────────────────────────────
SELECT (public.ervenow_diagnose_service_bookings_schema()->>'generated_insert_sql') AS copy_this_insert_sql;

-- ─── 8) ALTER TABLE orders المقترح (فقط الأعمدة غير الموجودة) ─────────────
SELECT format(
  'ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS %I %s;',
  column_name,
  CASE
    WHEN data_type = 'uuid' THEN 'uuid'
    WHEN data_type = 'integer' THEN 'integer'
    WHEN data_type = 'boolean' THEN 'boolean'
    WHEN data_type = 'timestamp with time zone' THEN 'timestamptz'
    WHEN data_type = 'numeric' THEN 'numeric(14,2)'
    WHEN data_type = 'jsonb' THEN 'jsonb'
    ELSE 'text'
  END
) AS suggested_alter
FROM (
  VALUES
    ('order_type', 'text'),
    ('provider_id', 'uuid'),
    ('service_type', 'text'),
    ('service_name', 'text'),
    ('delivery_status', 'text'),
    ('service_location', 'text'),
    ('service_qty', 'integer'),
    ('district', 'text'),
    ('gas_mode', 'text'),
    ('gas_liters', 'integer'),
    ('platform_commission', 'numeric'),
    ('provider_completed_at', 'timestamptz'),
    ('customer_confirmed_at', 'timestamptz'),
    ('service_rating', 'integer'),
    ('service_review', 'text'),
    ('service_rated_at', 'timestamptz'),
    ('commission_settled', 'boolean'),
    ('commission_due', 'boolean'),
    ('commission_paid_at', 'timestamptz'),
    ('scheduled_at', 'timestamptz')
) AS needed(column_name, data_type)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'orders' AND c.column_name = needed.column_name
);
