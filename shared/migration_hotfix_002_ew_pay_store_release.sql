-- HOTFIX-002: إطلاق رصيد ERVENOW PAY المعلّق لطلبات المتجر (store_id بدون merchant_id)
-- نفّذ في Supabase SQL Editor بعد migration_ervenow_pay_checkout.sql

CREATE OR REPLACE FUNCTION public.ervenow_ledger_release_ew_pay_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  wid_merchant uuid;
  merchant_uid uuid;
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

  merchant_uid := o.merchant_id;

  IF merchant_uid IS NULL AND o.store_id IS NOT NULL THEN
    SELECT coalesce(s.owner_user_id, u.id)
      INTO merchant_uid
    FROM public.stores s
    LEFT JOIN public.users u ON u.phone = s.phone
    WHERE s.id = o.store_id
    LIMIT 1;
  END IF;

  IF merchant_uid IS NOT NULL THEN
    wid_merchant := public.ervenow_ledger_ensure_wallet(merchant_uid, 'merchant');
    hold_ref := 'order:' || p_order_id::text || ':hold:merchant';
    rel := public.ervenow_ledger_complete_pending_by_ref(wid_merchant, hold_ref);
  ELSE
    rel := jsonb_build_object('ok', true, 'reason', 'no_merchant');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'released', 'pending', rel);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_release_ew_pay_order(uuid) TO authenticated, service_role;
