-- محفظة عمولة COD للمندوبين: دين على المندوب (7%) يُسجَّل عند التسليم ويُحصَّل عبر payout
-- نفّذ في Supabase SQL Editor بعد التأكد من وجود public.users و public.orders

CREATE TABLE IF NOT EXISTS public.driver_wallets (
  driver_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  balance numeric(14, 2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.driver_wallets IS 'رصيد عمولة مستحقة على المندوب (COD) — يزيد عند التسليم وينقص عند التحصيل';
COMMENT ON COLUMN public.driver_wallets.balance IS 'مجموع العمولات المستحقة غير المحصّلة (ريال)';

CREATE TABLE IF NOT EXISTS public.driver_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('commission', 'payout', 'adjustment')),
  amount numeric(14, 2) NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.driver_ledger IS 'دفتر عمولات المندوب (COD): commission عند التسليم، payout عند التحصيل';

CREATE INDEX IF NOT EXISTS driver_ledger_driver_created_idx
  ON public.driver_ledger (driver_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_ledger_commission_per_order
  ON public.driver_ledger (order_id)
  WHERE type = 'commission' AND order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.driver_ledger_is_cod_payment(p_method text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_method, ''))) IN ('cash', 'cash_on_delivery', 'cod', 'cod_payment');
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_order_billable(p_order public.orders)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT round(
    coalesce(
      nullif(p_order.total_with_vat, 0),
      nullif(p_order.platform_fee, 0),
      (coalesce(p_order.order_total, 0) + coalesce(p_order.delivery_fee, 0) + coalesce(p_order.vat_amount, 0)),
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
  v_amt numeric(14, 2);
  v_rate numeric := 0.07;
  v_comm numeric(14, 2);
  v_row_id uuid;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF lower(coalesce(o.delivery_status, o.status, '')) <> 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  IF o.driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_driver');
  END IF;

  IF NOT public.driver_ledger_is_cod_payment(o.payment_method) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'not_cod', 'skipped', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.driver_ledger l
    WHERE l.order_id = p_order_id AND l.type = 'commission'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_recorded');
  END IF;

  v_amt := public.driver_ledger_order_billable(o);
  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'zero_billable', 'amount', 0);
  END IF;

  IF o.platform_fee IS NOT NULL AND o.platform_fee > 0 THEN
    v_comm := round(o.platform_fee::numeric, 2);
  ELSE
    v_comm := round((v_amt * v_rate)::numeric, 2);
  END IF;

  IF v_comm <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'zero_commission', 'amount', 0);
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
      'payment_method', o.payment_method,
      'order_number', o.order_number
    )
  )
  RETURNING id INTO v_row_id;

  INSERT INTO public.driver_wallets (driver_id, balance, updated_at)
  VALUES (o.driver_id, v_comm, now())
  ON CONFLICT (driver_id) DO UPDATE SET
    balance = public.driver_wallets.balance + excluded.balance,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'commission_recorded',
    'ledger_id', v_row_id,
    'amount', v_comm,
    'driver_id', o.driver_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_recorded');
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_collect(
  p_driver_id uuid,
  p_amount numeric,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bal numeric(14, 2);
  v_amt numeric(14, 2);
  v_row_id uuid;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'driver_id_required');
  END IF;

  v_amt := round(coalesce(p_amount, 0)::numeric, 2);
  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  INSERT INTO public.driver_wallets (driver_id, balance, updated_at)
  VALUES (p_driver_id, 0, now())
  ON CONFLICT (driver_id) DO NOTHING;

  SELECT balance INTO v_bal FROM public.driver_wallets WHERE driver_id = p_driver_id FOR UPDATE;
  v_bal := coalesce(v_bal, 0);

  IF v_bal < v_amt THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance', v_bal,
      'requested', v_amt
    );
  END IF;

  INSERT INTO public.driver_ledger (driver_id, order_id, type, amount, meta)
  VALUES (
    p_driver_id,
    NULL,
    'payout',
    v_amt,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('collected_at', now())
  )
  RETURNING id INTO v_row_id;

  UPDATE public.driver_wallets
  SET balance = balance - v_amt, updated_at = now()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'collected',
    'ledger_id', v_row_id,
    'amount', v_amt,
    'balance_after', v_bal - v_amt
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_ledger_get_balance(p_driver_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT balance FROM public.driver_wallets WHERE driver_id = p_driver_id),
    0
  )::numeric;
$$;

COMMENT ON FUNCTION public.driver_ledger_apply_commission_on_delivered(uuid) IS
  'عند تسليم طلب COD: عمولة 7% (أو platform_fee) في driver_ledger + زيادة driver_wallets.balance';
COMMENT ON FUNCTION public.driver_ledger_collect(uuid, numeric, jsonb) IS
  'تحصيل عمولة من المندوب — type=payout وخصم من balance';
COMMENT ON FUNCTION public.driver_ledger_get_balance(uuid) IS
  'رصيد العمولة المستحقة على المندوب';

GRANT EXECUTE ON FUNCTION public.driver_ledger_apply_commission_on_delivered(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_ledger_collect(uuid, numeric, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_ledger_get_balance(uuid) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.driver_wallets TO authenticated, service_role;
GRANT SELECT, INSERT ON public.driver_ledger TO authenticated, service_role;
