-- HOTFIX-001: إيقاف إيداع التاجر المزدوج من RPC التسوية (يُدار من Node: storeMerchantLedgerCredit)
-- نفّذ في Supabase SQL Editor بعد migration_ervenow_pay_checkout.sql

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
    'merchant', amt_merchant,
    'ew_pay', ew_paid
  );
END;
$$;
