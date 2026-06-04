-- ERVENOW PAY — دفع السلة من محفظة العميل، رصيد معلّق للمستفيد حتى اكتمال الطلب
-- نفّذ في Supabase SQL Editor بعد migration_unified_finance_ledger.sql

-- حركة معلّقة (لا تدخل في balance حتى status = completed)
CREATE OR REPLACE FUNCTION public.ervenow_ledger_append_pending(
  p_wallet_id uuid,
  p_type text,
  p_direction text,
  p_amount numeric,
  p_reference_id text,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_wallet_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'skip_zero');
  END IF;
  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ervenow_ledger_transactions t
    WHERE t.wallet_id = p_wallet_id
      AND t.reference_id = p_reference_id
      AND t.status IN ('pending', 'completed')
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate');
  END IF;
  INSERT INTO public.ervenow_ledger_transactions (
    wallet_id, type, direction, amount, status, reference_id, description
  ) VALUES (
    p_wallet_id, p_type, p_direction, round(p_amount::numeric, 2), 'pending',
    p_reference_id, p_description
  );
  RETURN jsonb_build_object('ok', true, 'reason', 'inserted_pending');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_pending_balance(p_wallet_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(coalesce(sum(
    CASE
      WHEN t.status = 'pending' AND t.direction = 'credit' THEN t.amount
      WHEN t.status = 'pending' AND t.direction = 'debit' THEN -t.amount
      ELSE 0::numeric
    END
  ), 0)::numeric, 2)
  FROM public.ervenow_ledger_transactions t
  WHERE t.wallet_id = p_wallet_id;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_complete_pending_by_ref(p_wallet_id uuid, p_reference_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE public.ervenow_ledger_transactions t
  SET status = 'completed'
  WHERE t.wallet_id = p_wallet_id
    AND t.reference_id = p_reference_id
    AND t.status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'none_pending');
  END IF;
  RETURN jsonb_build_object('ok', true, 'reason', 'completed', 'count', n);
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_order_paid_via_ew_pay(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ervenow_ledger_transactions t
    JOIN public.ervenow_ledger_wallets w ON w.id = t.wallet_id
    WHERE w.role = 'customer'
      AND t.type = 'payment'
      AND t.direction = 'debit'
      AND t.status = 'completed'
      AND t.reference_id = 'pay:order:' || p_order_id::text
  );
$$;

-- دفع طلب: خصم عميل + إيداع منصة (ضمان) + رصيد معلّق للتاجر/المزود
CREATE OR REPLACE FUNCTION public.ervenow_ledger_checkout_ew_pay(
  p_customer_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_merchant_user_id uuid DEFAULT NULL,
  p_merchant_pending_amount numeric DEFAULT 0,
  p_description text DEFAULT 'شراء عبر ERVENOW PAY'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay_res jsonb;
  wid_platform uuid;
  wid_merchant uuid;
  escrow_ref text;
  hold_ref text;
  hold_amt numeric(14, 2);
BEGIN
  IF p_customer_id IS NULL OR p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_ids');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  pay_res := public.ervenow_ledger_pay(p_customer_id, p_amount, p_order_id, p_description);
  IF coalesce(pay_res->>'ok', '') NOT IN ('true', 't') THEN
    RETURN pay_res;
  END IF;

  SELECT w.id INTO wid_platform FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true LIMIT 1;
  IF wid_platform IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  END IF;

  escrow_ref := 'escrow:order:' || p_order_id::text;
  PERFORM public.ervenow_ledger_append_completed(
    wid_platform, 'deposit', 'credit', p_amount, escrow_ref, 'ضمان ERVENOW PAY — طلب'
  );

  hold_amt := round(coalesce(p_merchant_pending_amount, 0)::numeric, 2);
  IF p_merchant_user_id IS NOT NULL AND hold_amt > 0 THEN
    wid_merchant := public.ervenow_ledger_ensure_wallet(p_merchant_user_id, 'merchant');
    hold_ref := 'order:' || p_order_id::text || ':hold:merchant';
    PERFORM public.ervenow_ledger_append_pending(
      wid_merchant, 'deposit', 'credit', hold_amt, hold_ref, 'رصيد معلّق — ERVENOW PAY'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'paid',
    'amount', round(p_amount::numeric, 2),
    'merchant_hold', hold_amt
  );
END;
$$;

-- إطلاق الرصيد المعلّق للمستفيد عند اكتمال الطلب (قبل/مع التسوية)
CREATE OR REPLACE FUNCTION public.ervenow_ledger_release_ew_pay_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  wid_merchant uuid;
  hold_ref text;
  rel jsonb;
BEGIN
  IF NOT public.ervenow_ledger_order_paid_via_ew_pay(p_order_id) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'not_ew_pay');
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF o.merchant_id IS NOT NULL THEN
    wid_merchant := public.ervenow_ledger_ensure_wallet(o.merchant_id, 'merchant');
    hold_ref := 'order:' || p_order_id::text || ':hold:merchant';
    rel := public.ervenow_ledger_complete_pending_by_ref(wid_merchant, hold_ref);
  ELSE
    rel := jsonb_build_object('ok', true, 'reason', 'no_merchant');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'released', 'pending', rel);
END;
$$;

-- ملخص محفظة مع الرصيد المعلّق
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
  v_pending numeric(14, 2);
  v_earned numeric(14, 2);
  v_commission numeric(14, 2);
  v_tx_count bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  wid := public.ervenow_ledger_ensure_wallet(p_user_id, coalesce(p_role, 'customer'));
  v_balance := public.ervenow_ledger_wallet_balance(wid);
  v_pending := public.ervenow_ledger_pending_balance(wid);

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
    'pending_balance', v_pending,
    'total_earned', v_earned,
    'total_commission', v_commission,
    'transaction_count', v_tx_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_append_pending(uuid, text, text, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_pending_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_complete_pending_by_ref(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_order_paid_via_ew_pay(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_checkout_ew_pay(uuid, uuid, numeric, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_release_ew_pay_order(uuid) TO authenticated, service_role;

-- تسوية التسليم: عند ERVENOW PAY لا يُضاف إيداع تاجر مكرّر (يُفعَّل الرصيد المعلّق عبر release)
CREATE OR REPLACE FUNCTION public.ervenow_ledger_settle_delivered_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  wid_driver uuid;
  wid_platform uuid;
  wid_merchant uuid;
  amt_driver numeric(14, 2);
  amt_platform numeric(14, 2);
  amt_merchant numeric(14, 2);
  driver_component numeric(14, 2);
  ref_prefix text;
  ew_paid boolean;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF lower(coalesce(o.delivery_status, o.status, '')) <> 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  ew_paid := public.ervenow_ledger_order_paid_via_ew_pay(p_order_id);
  IF ew_paid THEN
    PERFORM public.ervenow_ledger_release_ew_pay_order(p_order_id);
  END IF;

  ref_prefix := 'order:' || p_order_id::text;

  SELECT w.id INTO wid_platform FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true LIMIT 1;
  IF wid_platform IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  END IF;

  driver_component := round(coalesce(nullif(o.driver_earning, 0), nullif(o.delivery_fee, 0), 0)::numeric, 2);
  amt_driver := driver_component;
  amt_platform := round(coalesce(o.platform_fee, 0)::numeric, 2);

  -- صافي التاجر يُودَع من التطبيق عند التسليم (storeMerchantLedgerCredit) بمرجع order:{id}:merchant_net
  amt_merchant := 0;

  IF o.driver_id IS NOT NULL AND amt_driver > 0 THEN
    wid_driver := public.ervenow_ledger_ensure_wallet(o.driver_id, 'driver');
    PERFORM public.ervenow_ledger_append_completed(
      wid_driver, 'earning', 'credit', amt_driver, ref_prefix || ':earning', 'أجر توصيل طلب'
    );
  END IF;

  IF amt_platform > 0 THEN
    PERFORM public.ervenow_ledger_append_completed(
      wid_platform, 'commission', 'credit', amt_platform, ref_prefix || ':commission', 'عمولة منصة'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'settled',
    'driver', amt_driver,
    'platform', amt_platform,
    'merchant', CASE WHEN ew_paid THEN 0 ELSE amt_merchant END,
    'ew_pay', ew_paid
  );
END;
$$;
