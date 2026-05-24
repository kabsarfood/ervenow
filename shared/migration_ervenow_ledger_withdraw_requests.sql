-- =============================================================================
-- ERVENOW — Ledger withdraw_requests + finance summary RPCs
-- يتطلب: migration_unified_finance_ledger.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  note text
);

CREATE INDEX IF NOT EXISTS idx_withdraw_requests_user_created
  ON public.withdraw_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status
  ON public.withdraw_requests (status, created_at DESC);

COMMENT ON TABLE public.withdraw_requests IS 'طلبات سحب مرتبطة بـ ervenow_ledger (Shadow → Primary)';

-- ——— ملخص مالي للأدمن (ledger فقط) ———
CREATE OR REPLACE FUNCTION public.ervenow_ledger_finance_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'platform_commission_total', round(coalesce((
      SELECT sum(t.amount)
      FROM public.ervenow_ledger_transactions t
      JOIN public.ervenow_ledger_wallets w ON w.id = t.wallet_id
      WHERE w.is_platform = true
        AND t.type = 'commission'
        AND t.direction = 'credit'
        AND t.status = 'completed'
    ), 0)::numeric, 2),
    'driver_earnings_total', round(coalesce((
      SELECT sum(t.amount)
      FROM public.ervenow_ledger_transactions t
      JOIN public.ervenow_ledger_wallets w ON w.id = t.wallet_id
      WHERE w.role = 'driver'
        AND t.type = 'earning'
        AND t.direction = 'credit'
        AND t.status = 'completed'
    ), 0)::numeric, 2),
    'service_commission_total', round(coalesce((
      SELECT sum(t.amount)
      FROM public.ervenow_ledger_transactions t
      JOIN public.ervenow_ledger_wallets w ON w.id = t.wallet_id
      WHERE w.role = 'service'
        AND t.type = 'commission'
        AND t.direction = 'debit'
        AND t.status = 'completed'
    ), 0)::numeric, 2),
    'store_earnings_total', round(coalesce((
      SELECT sum(t.amount)
      FROM public.ervenow_ledger_transactions t
      JOIN public.ervenow_ledger_wallets w ON w.id = t.wallet_id
      WHERE w.role IN ('store', 'merchant', 'restaurant')
        AND t.type = 'deposit'
        AND t.direction = 'credit'
        AND t.status = 'completed'
    ), 0)::numeric, 2)
  );
$$;

-- ——— ملخص محفظة مستخدم (ledger) ———
CREATE OR REPLACE FUNCTION public.ervenow_ledger_user_wallet_summary(p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wid uuid;
  v_balance numeric(14, 2);
  v_earned numeric(14, 2);
  v_commission numeric(14, 2);
  v_tx_count bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  wid := public.ervenow_ledger_ensure_wallet(p_user_id, coalesce(p_role, 'customer'));
  v_balance := public.ervenow_ledger_wallet_balance(wid);

  SELECT count(*) INTO v_tx_count
  FROM public.ervenow_ledger_transactions t
  WHERE t.wallet_id = wid AND t.status = 'completed';

  SELECT round(coalesce(sum(t.amount), 0)::numeric, 2) INTO v_earned
  FROM public.ervenow_ledger_transactions t
  WHERE t.wallet_id = wid
    AND t.status = 'completed'
    AND t.direction = 'credit'
    AND t.type IN ('earning', 'deposit');

  SELECT round(coalesce(sum(t.amount), 0)::numeric, 2) INTO v_commission
  FROM public.ervenow_ledger_transactions t
  WHERE t.wallet_id = wid
    AND t.status = 'completed'
    AND t.direction = 'debit'
    AND t.type = 'commission';

  RETURN jsonb_build_object(
    'ok', true,
    'wallet_id', wid,
    'balance', v_balance,
    'total_earned', v_earned,
    'total_commission', v_commission,
    'transaction_count', v_tx_count
  );
END;
$$;

-- ——— موافقة سحب: خصم من ledger ———
CREATE OR REPLACE FUNCTION public.ledger_withdraw_request_approve(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  urole text;
  wid uuid;
  amt numeric(14, 2);
  bal numeric(14, 2);
  ref text;
BEGIN
  SELECT * INTO r FROM public.withdraw_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  IF r.status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_approved');
  END IF;

  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', r.status);
  END IF;

  amt := round(coalesce(r.amount, 0)::numeric, 2);
  IF amt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  SELECT role INTO urole FROM public.users WHERE id = r.user_id LIMIT 1;
  wid := public.ervenow_ledger_ensure_wallet(r.user_id, coalesce(urole, 'driver'));
  bal := public.ervenow_ledger_wallet_balance(wid);

  IF bal < amt THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal, 'amount', amt);
  END IF;

  ref := 'withdraw:' || p_request_id::text;

  IF EXISTS (
    SELECT 1 FROM public.ervenow_ledger_transactions t
    WHERE t.wallet_id = wid AND t.reference_id = ref AND t.status = 'completed'
  ) THEN
    UPDATE public.withdraw_requests
    SET status = 'approved', processed_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'reason', 'already_processed');
  END IF;

  INSERT INTO public.ervenow_ledger_transactions (
    wallet_id, type, direction, amount, status, reference_id, description
  )
  VALUES (wid, 'withdraw', 'debit', amt, 'completed', ref, 'سحب — موافقة إدارية');

  UPDATE public.withdraw_requests
  SET status = 'approved', processed_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'approved', 'amount', amt, 'balance_after', bal - amt);
EXCEPTION
  WHEN unique_violation THEN
    UPDATE public.withdraw_requests
    SET status = 'approved', processed_at = coalesce(processed_at, now())
    WHERE id = p_request_id AND status = 'pending';
    RETURN jsonb_build_object('ok', true, 'reason', 'already_processed');
END;
$$;

COMMENT ON FUNCTION public.ledger_withdraw_request_approve(uuid) IS
  'موافقة طلب سحب withdraw_requests — debit type=withdraw في ervenow_ledger';
