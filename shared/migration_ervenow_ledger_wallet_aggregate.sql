-- ملخص محفظة باستعلام واحد. نفس قواعد الرصيد الحالية:
-- available_balance = مجموع الإتمام الدائن − مجموع الإتمام المدين
-- total_earned = إتمام دائن من نوع earning أو deposit
-- total_commission = إتمام مدين من نوع commission
-- pending_balance = معلّق دائن − معلّق مدين
-- لا يُنشئ محفظة إن لم تكن موجودة.

CREATE OR REPLACE FUNCTION public.ervenow_ledger_wallet_aggregate(
  p_user_id uuid,
  p_role text,
  p_today_start timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wid uuid;
  v_credits numeric(14, 2);
  v_debits numeric(14, 2);
  v_earned numeric(14, 2);
  v_commission numeric(14, 2);
  v_pending numeric(14, 2);
  v_today numeric(14, 2);
  v_count bigint;
  v_balance numeric(14, 2);
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  SELECT w.id
    INTO wid
  FROM public.ervenow_ledger_wallets w
  WHERE w.user_id = p_user_id
    AND w.role = coalesce(nullif(btrim(p_role), ''), 'customer')
  LIMIT 1;

  IF wid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'has_data', false,
      'wallet_id', NULL,
      'available_balance', 0,
      'balance', 0,
      'pending_balance', 0,
      'total_credits', 0,
      'total_debits', 0,
      'total_earned', 0,
      'total_commission', 0,
      'earned_today', 0,
      'transaction_count', 0
    );
  END IF;

  SELECT
    round(coalesce(sum(CASE WHEN t.status = 'completed' AND t.direction = 'credit' THEN t.amount ELSE 0 END), 0)::numeric, 2),
    round(coalesce(sum(CASE WHEN t.status = 'completed' AND t.direction = 'debit' THEN t.amount ELSE 0 END), 0)::numeric, 2),
    round(coalesce(sum(CASE WHEN t.status = 'completed' AND t.direction = 'credit' AND t.type IN ('earning', 'deposit') THEN t.amount ELSE 0 END), 0)::numeric, 2),
    round(coalesce(sum(CASE WHEN t.status = 'completed' AND t.direction = 'debit' AND t.type = 'commission' THEN t.amount ELSE 0 END), 0)::numeric, 2),
    round(coalesce(sum(CASE
      WHEN t.status = 'pending' AND t.direction = 'credit' THEN t.amount
      WHEN t.status = 'pending' AND t.direction = 'debit' THEN -t.amount
      ELSE 0
    END), 0)::numeric, 2),
    round(coalesce(sum(CASE
      WHEN p_today_start IS NOT NULL
        AND t.status = 'completed'
        AND t.direction = 'credit'
        AND t.created_at >= p_today_start
      THEN t.amount
      ELSE 0
    END), 0)::numeric, 2),
    count(*) FILTER (WHERE t.status = 'completed')
  INTO v_credits, v_debits, v_earned, v_commission, v_pending, v_today, v_count
  FROM public.ervenow_ledger_transactions t
  WHERE t.wallet_id = wid;

  v_balance := round(coalesce(v_credits, 0) - coalesce(v_debits, 0), 2);

  RETURN jsonb_build_object(
    'ok', true,
    'has_data', (coalesce(v_count, 0) > 0 OR v_balance <> 0 OR coalesce(v_earned, 0) > 0 OR coalesce(v_commission, 0) > 0),
    'wallet_id', wid,
    'available_balance', v_balance,
    'balance', v_balance,
    'pending_balance', coalesce(v_pending, 0),
    'total_credits', coalesce(v_credits, 0),
    'total_debits', coalesce(v_debits, 0),
    'total_earned', coalesce(v_earned, 0),
    'total_commission', coalesce(v_commission, 0),
    'earned_today', coalesce(v_today, 0),
    'transaction_count', coalesce(v_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ervenow_ledger_wallet_aggregate(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ervenow_ledger_wallet_aggregate(uuid, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_wallet_aggregate(uuid, text, timestamptz) TO service_role;
