-- ERVENOW — عمولة COD مرنة: payment_method من العمود أو JSON، ومبالغ من total_amount أو data
-- نفّذ في Supabase SQL Editor بعد migration_driver_commission_ledger.sql
-- idempotent — آمن للتكرار

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS data jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS breakdown jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_amount numeric(14, 2);

CREATE OR REPLACE FUNCTION public.driver_ledger_order_payment_method(o public.orders)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(coalesce(
    o.payment_method,
    o.data->>'paymentMethod',
    o.data->>'payment_method',
    o.breakdown->>'paymentMethod',
    o.breakdown->>'payment_method',
    ''
  )));
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_order_total_amount(o public.orders)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(o.total_amount, 0),
    nullif((o.data->>'total')::numeric, 0),
    nullif((o.data->>'total_amount')::numeric, 0),
    nullif((o.data->>'totalWithVat')::numeric, 0),
    nullif((o.breakdown->>'total')::numeric, 0),
    nullif((o.breakdown->>'total_amount')::numeric, 0),
    0::numeric
  );
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_is_cod_payment(p_method text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_method, ''))) IN (
    'cash',
    'cod',
    'cash_on_delivery',
    'cod_payment',
    'delivery'
  );
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_order_billable(p_order public.orders)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT round(
    coalesce(
      nullif(p_order.total_with_vat, 0),
      (coalesce(p_order.order_total, 0) + coalesce(p_order.delivery_fee, 0) + coalesce(p_order.vat_amount, 0)),
      nullif(public.driver_ledger_order_total_amount(p_order), 0),
      nullif(p_order.platform_fee, 0),
      p_order.total_amount,
      p_order.order_total,
      0
    )::numeric,
    2
  );
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_apply_commission_on_delivered(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders%ROWTYPE;
  v_payment text;
  v_amt numeric(14, 2);
  v_rate numeric := 0.07;
  v_comm numeric(14, 2);
  v_row_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_order_id');
  END IF;

  RAISE NOTICE 'driver_ledger: commission check for order %', p_order_id;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF lower(coalesce(o.delivery_status, o.status, '')) <> 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  IF o.driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_driver', 'skipped', true);
  END IF;

  v_payment := public.driver_ledger_order_payment_method(o);

  IF NOT public.driver_ledger_is_cod_payment(v_payment) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reason', 'not_cod',
      'skipped', true,
      'payment_method', v_payment
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.driver_ledger l
    WHERE l.order_id = p_order_id AND l.type = 'commission'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_recorded');
  END IF;

  v_amt := public.driver_ledger_order_billable(o);
  IF v_amt IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'zero_billable', 'amount', 0, 'skipped', true);
  END IF;

  IF o.platform_fee IS NOT NULL AND o.platform_fee > 0 THEN
    v_comm := round(o.platform_fee::numeric, 2);
  ELSE
    v_comm := round((v_amt * v_rate)::numeric, 2);
  END IF;

  IF v_comm IS NULL OR v_comm <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'zero_commission', 'amount', 0, 'skipped', true);
  END IF;

  INSERT INTO public.driver_ledger (driver_id, order_id, type, amount, meta)
  VALUES (
    o.driver_id,
    p_order_id,
    'commission',
    v_comm,
    jsonb_build_object(
      'rate', v_rate,
      'billable', v_amt,
      'payment_method', v_payment,
      'order_number', o.order_number,
      'source', 'driver_ledger_apply_commission_on_delivered'
    )
  )
  RETURNING id INTO v_row_id;

  INSERT INTO public.driver_wallets (driver_id, balance, updated_at)
  VALUES (o.driver_id, v_comm, now())
  ON CONFLICT (driver_id) DO UPDATE SET
    balance = public.driver_wallets.balance + excluded.balance,
    updated_at = now();

  RAISE NOTICE 'Commission applied for order % driver % amount %', p_order_id, o.driver_id, v_comm;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'commission_recorded',
    'ledger_id', v_row_id,
    'amount', v_comm,
    'driver_id', o.driver_id,
    'payment_method', v_payment,
    'billable', v_amt
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_recorded');
  WHEN OTHERS THEN
    RAISE NOTICE 'driver_ledger commission error order %: %', p_order_id, SQLERRM;
    RETURN jsonb_build_object('ok', false, 'reason', 'error', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.driver_ledger_order_payment_method(public.orders) IS
  'COALESCE(payment_method, data.paymentMethod, breakdown)';
COMMENT ON FUNCTION public.driver_ledger_order_total_amount(public.orders) IS
  'COALESCE(total_amount, data.total, breakdown.total)';
COMMENT ON FUNCTION public.driver_ledger_apply_commission_on_delivered(uuid) IS
  'عمولة COD عند التسليم — مرن مع JSON والأعمدة، بدون تكرار لكل طلب';

GRANT EXECUTE ON FUNCTION public.driver_ledger_order_payment_method(public.orders) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_ledger_order_total_amount(public.orders) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_ledger_apply_commission_on_delivered(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
