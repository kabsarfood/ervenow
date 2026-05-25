-- =============================================================================
-- ERVENOW Unification — service_bookings → orders (مصدر وحيد)
-- ⚠️ استُبدِل بـ: migration_unification_11_smart_service_bookings_to_orders.sql
--    (يقرأ information_schema — لا يفترض أسماء أعمدة)
-- =============================================================================

-- 1) أعمدة الطلب الموحّد
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

COMMENT ON COLUMN public.orders.order_type IS 'delivery | store | restaurant | service | gas_delivery | food';
COMMENT ON COLUMN public.orders.provider_id IS 'مزود الخدمة (users.id) — يُزامَن مع service_provider_id';

CREATE INDEX IF NOT EXISTS idx_orders_provider ON public.orders (provider_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON public.orders (order_type);
CREATE INDEX IF NOT EXISTS idx_orders_service_type ON public.orders (service_type) WHERE order_type = 'service';

-- 2) نقل البيانات (idempotent — لا يكرّر إن وُجد الصف)
INSERT INTO public.orders (
  id,
  customer_id,
  customer_phone,
  provider_id,
  service_provider_id,
  order_type,
  service_type,
  service_name,
  delivery_status,
  order_number,
  order_total,
  total_amount,
  platform_commission,
  platform_fee,
  payment_status,
  district,
  service_location,
  service_qty,
  gas_mode,
  gas_liters,
  provider_completed_at,
  customer_confirmed_at,
  commission_settled,
  commission_due,
  commission_paid_at,
  service_rating,
  service_review,
  service_rated_at,
  scheduled_at,
  created_at,
  updated_at
)
SELECT
  sb.id,
  sb.customer_id,
  sb.customer_phone,
  sb.provider_id,
  sb.provider_id,
  'service',
  sb.service_type,
  sb.service_name,
  CASE lower(coalesce(sb.status, 'new'))
    WHEN 'new' THEN 'pending'
    WHEN 'completed' THEN 'delivered'
    ELSE lower(coalesce(sb.status, 'pending'))
  END,
  coalesce(sb.service_order_number, 'SV-MIG-' || left(sb.id::text, 8)),
  coalesce(sb.total_amount, 0),
  coalesce(sb.total_amount, 0),
  coalesce(sb.platform_commission, 0),
  coalesce(sb.platform_commission, 0),
  coalesce(sb.payment_status, 'unpaid'),
  sb.district,
  sb.location,
  coalesce(sb.qty, 1),
  sb.gas_mode,
  sb.gas_liters,
  sb.provider_completed_at,
  sb.customer_confirmed_at,
  coalesce(sb.commission_settled, false),
  coalesce(sb.commission_due, false),
  sb.commission_paid_at,
  sb.rating,
  sb.review,
  sb.rated_at,
  NULL,
  coalesce(sb.created_at, now()),
  coalesce(sb.updated_at, sb.created_at, now())
FROM public.service_bookings sb
WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = sb.id);

-- 3) RPC ledger — يقرأ orders بدل service_bookings
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

-- 4) تعطيل service_bookings
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
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.block_service_bookings_legacy()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'service_bookings disabled — use orders (order_type=service)';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings_legacy'
  ) THEN
    DROP TRIGGER IF EXISTS prevent_service_bookings_insert ON public.service_bookings_legacy;
    CREATE TRIGGER prevent_service_bookings_insert
      BEFORE INSERT OR UPDATE OR DELETE ON public.service_bookings_legacy
      FOR EACH ROW EXECUTE FUNCTION public.block_service_bookings_legacy();
  END IF;
END $$;

-- تحقق:
-- SELECT count(*) FROM service_bookings_legacy;
-- SELECT count(*) FROM orders WHERE order_type = 'service';

NOTIFY pgrst, 'reload schema';
