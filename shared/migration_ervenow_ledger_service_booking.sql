-- =============================================================================
-- ERVENOW — Shadow Ledger: تسوية service_bookings في ervenow_ledger_*
-- يتطلب: migration_unified_finance_ledger.sql
-- نفّذ في Supabase → SQL Editor
-- =============================================================================

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

  SELECT * INTO b FROM public.service_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  END IF;

  IF lower(coalesce(b.status, '')) <> 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  IF b.provider_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_provider');
  END IF;

  v_comm := round(coalesce(b.total_amount, 0)::numeric * 0.07, 2);
  IF v_comm <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'skip_zero');
  END IF;

  v_ref := 'booking:' || p_booking_id::text || ':service_commission';

  IF EXISTS (
    SELECT 1
    FROM public.ervenow_ledger_transactions t
    WHERE t.reference_id = v_ref
      AND t.status = 'completed'
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate', 'commission', v_comm);
  END IF;

  SELECT w.id INTO wid_platform
  FROM public.ervenow_ledger_wallets w
  WHERE w.is_platform = true
  LIMIT 1;
  IF wid_platform IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  END IF;

  wid_provider := public.ervenow_ledger_ensure_wallet(b.provider_id, 'service');

  r_platform := public.ervenow_ledger_append_completed(
    wid_platform,
    'commission',
    'credit',
    v_comm,
    v_ref,
    'عمولة منصة — خدمة'
  );

  r_provider := public.ervenow_ledger_append_completed(
    wid_provider,
    'commission',
    'debit',
    v_comm,
    v_ref,
    'عمولة مستحقة — خدمة'
  );

  RAISE NOTICE 'Service ledger applied: %', p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'settled',
    'commission', v_comm,
    'provider_id', b.provider_id,
    'reference_id', v_ref,
    'platform', r_platform,
    'provider', r_provider
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'ervenow_ledger_settle_service_booking error %: %', p_booking_id, SQLERRM;
    RETURN jsonb_build_object('ok', false, 'reason', 'error', 'detail', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.ervenow_ledger_settle_service_booking(uuid) IS
  'Shadow ledger — عمولة خدمة 7%: credit منصة + debit مزود؛ idempotent عبر reference_id booking:{id}:service_commission';
