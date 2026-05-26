-- =============================================================================
-- إصلاح أجر المندوب عند التسليم (ledger_only)
-- نفّذ في Supabase SQL Editor بعد migration_bootstrap_ledger_finance.sql
-- =============================================================================

-- ervenow_ledger_credit — دعم suffix (earning للمندوب / provider_credit للمزود)
CREATE OR REPLACE FUNCTION public.ervenow_ledger_credit(
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_role text DEFAULT NULL,
  p_reference_suffix text DEFAULT 'provider_credit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wid uuid;
  r text;
  urole text;
  v_ref text;
  v_suffix text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_amount IS NULL OR round(p_amount::numeric, 2) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;
  IF coalesce(trim(p_reference), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_reference');
  END IF;

  SELECT u.role INTO urole FROM public.users u WHERE u.id = p_user_id LIMIT 1;
  r := coalesce(nullif(trim(p_role), ''), public.ervenow_ledger_map_user_role(urole), 'service');
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, r);
  v_suffix := coalesce(nullif(trim(p_reference_suffix), ''), 'provider_credit');
  v_ref := 'order:' || trim(p_reference) || ':' || v_suffix;

  RETURN public.ervenow_ledger_append_completed(
    wid,
    'earning',
    'credit',
    round(p_amount::numeric, 2),
    v_ref,
    CASE WHEN v_suffix = 'earning' THEN 'أجر توصيل — تسليم طلب' ELSE 'أرباح — تسليم طلب' END
  );
END;
$$;

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
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF lower(coalesce(o.delivery_status, o.status, '')) NOT IN ('delivered', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  ref_prefix := 'order:' || p_order_id::text;
  SELECT w.id INTO wid_platform FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true LIMIT 1;
  IF wid_platform IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  END IF;

  driver_component := round(coalesce(
    nullif(o.driver_earning, 0),
    nullif(o.delivery_fee, 0) - greatest(coalesce(o.platform_fee, o.platform_commission, 0), 0),
    nullif((o.data->>'driver_earning')::numeric, 0),
    nullif((o.data->>'delivery_fee')::numeric, 0),
    0
  )::numeric, 2);
  IF driver_component < 0 THEN
    driver_component := 0;
  END IF;
  IF driver_component = 0 AND coalesce(nullif(o.delivery_fee, 0), 0) > 0 THEN
    driver_component := round(o.delivery_fee::numeric, 2);
  END IF;

  amt_driver := driver_component;
  amt_platform := round(coalesce(o.platform_fee, o.platform_commission, 0)::numeric, 2);
  amt_merchant := round(greatest(
    coalesce(o.total_amount, o.order_total, 0)::numeric - coalesce(amt_platform, 0) - coalesce(driver_component, 0),
    0
  ), 2);

  IF o.driver_id IS NOT NULL AND amt_driver > 0 THEN
    wid_driver := public.ervenow_ledger_ensure_wallet(o.driver_id, 'driver');
    PERFORM public.ervenow_ledger_append_completed(
      wid_driver, 'earning', 'credit', amt_driver, ref_prefix || ':earning', 'أجر توصيل'
    );
  END IF;

  IF amt_platform > 0 THEN
    PERFORM public.ervenow_ledger_append_completed(
      wid_platform, 'commission', 'credit', amt_platform, ref_prefix || ':commission', 'عمولة منصة'
    );
  END IF;

  IF o.merchant_id IS NOT NULL AND amt_merchant > 0 THEN
    wid_merchant := public.ervenow_ledger_ensure_wallet(o.merchant_id, 'merchant');
    PERFORM public.ervenow_ledger_append_completed(
      wid_merchant, 'deposit', 'credit', amt_merchant, ref_prefix || ':merchant', 'صافي تاجر'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'reason', 'settled',
    'driver', amt_driver, 'platform', amt_platform, 'merchant', amt_merchant
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_credit(uuid, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_settle_delivered_order(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
