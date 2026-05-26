-- إيداع أرباح المزود عند التسليم (idempotent — reference_id فريد لكل طلب)
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

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_credit(uuid, numeric, text, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
