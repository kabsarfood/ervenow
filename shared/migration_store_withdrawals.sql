-- =============================================================================
-- طلبات سحب أرباح المتاجر + عمولة واضحة على المبيعات
-- نفّذ في Supabase بعد migration_store_wallet.sql و migration_store_products_ensure.sql
-- =============================================================================

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS offer_price numeric;

ALTER TABLE public.store_transactions ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS public.store_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_withdrawals_store_status_idx
  ON public.store_withdrawals (store_id, status, created_at DESC);

COMMENT ON TABLE public.store_withdrawals IS 'طلبات سحب رصيد المتجر — pending حتى موافقة الإدارة';

-- موافقة الإدارة: خصم الرصيد مرة واحدة + تعليم الطلب approved
CREATE OR REPLACE FUNCTION public.store_wallet_approve_withdrawal(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  bal numeric;
  v_inserted int;
BEGIN
  IF p_withdrawal_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_id');
  END IF;

  SELECT * INTO w FROM public.store_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF lower(w.status) <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  INSERT INTO public.store_wallets (store_id, balance)
  VALUES (w.store_id, 0)
  ON CONFLICT (store_id) DO NOTHING;

  SELECT balance INTO bal FROM public.store_wallets WHERE store_id = w.store_id FOR UPDATE;
  IF bal IS NULL THEN
    bal := 0;
  END IF;

  IF bal < w.amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal);
  END IF;

  UPDATE public.store_wallets
  SET balance = balance - w.amount
  WHERE store_id = w.store_id;

  INSERT INTO public.store_transactions (store_id, order_id, amount, type, description)
  VALUES (w.store_id, NULL, w.amount, 'debit', 'سحب أرباح #' || w.id::text);

  UPDATE public.store_withdrawals
  SET status = 'approved', updated_at = now()
  WHERE id = p_withdrawal_id AND status = 'pending';

  GET DIAGNOSTICS v_inserted = row_count;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'update_failed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'approved', 'amount', w.amount, 'store_id', w.store_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_wallet_approve_withdrawal(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
