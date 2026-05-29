-- دوال ledger الأساسية (مقتطف من bootstrap)
-- ─── 5) RPC: رصيد + محفظة + حركات ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ervenow_ledger_recalc_balance(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v numeric(14, 2);
BEGIN
  IF p_wallet_id IS NULL THEN RETURN; END IF;
  SELECT round(coalesce(sum(
    CASE
      WHEN t.status = 'completed' AND t.direction = 'credit' THEN t.amount
      WHEN t.status = 'completed' AND t.direction = 'debit' THEN -t.amount
      ELSE 0::numeric
    END
  ), 0)::numeric, 2)
  INTO v FROM public.ervenow_ledger_transactions t WHERE t.wallet_id = p_wallet_id;
  IF v < 0 THEN v := 0; END IF;
  UPDATE public.ervenow_ledger_wallets SET balance = v, updated_at = now() WHERE id = p_wallet_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_trg_refresh_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE wid uuid;
BEGIN
  wid := coalesce(NEW.wallet_id, OLD.wallet_id);
  IF wid IS NOT NULL THEN PERFORM public.ervenow_ledger_recalc_balance(wid); END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ervenow_ledger_tx_balance ON public.ervenow_ledger_transactions;
CREATE TRIGGER trg_ervenow_ledger_tx_balance
  AFTER INSERT OR UPDATE OF status, amount, direction ON public.ervenow_ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ervenow_ledger_trg_refresh_balance();

CREATE OR REPLACE FUNCTION public.ervenow_ledger_map_user_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_role, ''))
    WHEN 'driver' THEN 'driver'
    WHEN 'customer' THEN 'customer'
    WHEN 'admin' THEN 'admin'
    WHEN 'merchant' THEN 'store'
    WHEN 'restaurant' THEN 'store'
    WHEN 'store' THEN 'store'
    WHEN 'service' THEN 'service'
    ELSE 'customer'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_ensure_wallet(p_user_id uuid, p_role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wid uuid;
  r text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ervenow_ledger_ensure_wallet: user_id required';
  END IF;
  r := public.ervenow_ledger_map_user_role(p_role);
  SELECT w.id INTO wid
  FROM public.ervenow_ledger_wallets w
  WHERE w.user_id = p_user_id AND w.role = r AND w.is_platform = false
  LIMIT 1;
  IF wid IS NOT NULL THEN RETURN wid; END IF;
  INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
  VALUES (p_user_id, r, false, 0, 'SAR')
  RETURNING id INTO wid;
  RETURN wid;
EXCEPTION
  WHEN unique_violation THEN
    SELECT w.id INTO wid FROM public.ervenow_ledger_wallets w
    WHERE w.user_id = p_user_id AND w.role = r AND w.is_platform = false LIMIT 1;
    RETURN wid;
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_append_completed(
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
    WHERE t.wallet_id = p_wallet_id AND t.reference_id = p_reference_id AND t.status = 'completed'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate');
  END IF;
  INSERT INTO public.ervenow_ledger_transactions (
    wallet_id, type, direction, amount, status, reference_id, description
  ) VALUES (
    p_wallet_id, p_type, p_direction, round(p_amount::numeric, 2), 'completed',
    p_reference_id, p_description
  );
  RETURN jsonb_build_object('ok', true, 'reason', 'inserted');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', true, 'reason', 'duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_wallet_balance(p_wallet_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(coalesce(w.balance, 0)::numeric, 2)
  FROM public.ervenow_ledger_wallets w WHERE w.id = p_wallet_id;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_deposit(
  p_user_id uuid, p_role text, p_amount numeric, p_reference_id text, p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE wid uuid;
BEGIN
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, p_role);
  RETURN public.ervenow_ledger_append_completed(
    wid, 'deposit', 'credit', p_amount, p_reference_id, coalesce(p_description, 'إيداع')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_pay(
  p_user_id uuid, p_amount numeric, p_order_id uuid, p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE wid uuid; ref text; bal numeric(14, 2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, 'customer');
  bal := public.ervenow_ledger_wallet_balance(wid);
  IF bal < round(p_amount::numeric, 2) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal);
  END IF;
  ref := 'pay:order:' || p_order_id::text;
  RETURN public.ervenow_ledger_append_completed(
    wid, 'payment', 'debit', p_amount, ref, coalesce(p_description, 'دفع طلب')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_refund(
  p_user_id uuid, p_amount numeric, p_reference_id text, p_description text, p_role text DEFAULT 'customer'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE wid uuid; r text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;
  r := public.ervenow_ledger_map_user_role(coalesce(nullif(trim(p_role), ''), 'customer'));
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, r);
  RETURN public.ervenow_ledger_append_completed(
    wid, 'refund', 'credit', p_amount, p_reference_id, coalesce(p_description, 'استرجاع')
  );
END;
$$;
