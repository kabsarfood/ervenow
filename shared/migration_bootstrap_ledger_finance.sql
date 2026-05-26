-- =============================================================================
-- ERVENOW — Bootstrap: نظام Ledger المالي (من الصفر)
-- =============================================================================
-- نفّذ مرة واحدة في Supabase → SQL Editor (بالكامل).
-- يتطلب: جدول public.users موجود. يُفضّل وجود public.orders.
--
-- بعد التنفيذ:
--   FINANCE_MODE=ledger_only على الخادم
--   Supabase → Settings → API → Reload schema
--
-- تحقق:
--   SELECT count(*) FROM ervenow_ledger_wallets;
--   SELECT count(*) FROM ervenow_ledger_transactions;
--   SELECT count(*) FROM settlement_log;
--   SELECT count(*) FROM withdraw_requests;
-- =============================================================================

-- ─── 1) محافظ الدفتر ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ervenow_ledger_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users (id) ON DELETE RESTRICT,
  role text NOT NULL
    CHECK (role IN ('customer', 'driver', 'store', 'merchant', 'admin', 'platform', 'service', 'restaurant')),
  is_platform boolean NOT NULL DEFAULT false,
  balance numeric(14, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency text NOT NULL DEFAULT 'SAR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ervenow_ledger_wallet_actor CHECK (
    (is_platform = true AND user_id IS NULL)
    OR (is_platform = false AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ervenow_ledger_wallet_user_role
  ON public.ervenow_ledger_wallets (user_id, role)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ervenow_ledger_platform_singleton
  ON public.ervenow_ledger_wallets (is_platform)
  WHERE is_platform = true;

CREATE INDEX IF NOT EXISTS idx_ervenow_ledger_wallets_user
  ON public.ervenow_ledger_wallets (user_id);

-- ─── 2) حركات الدفتر ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ervenow_ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.ervenow_ledger_wallets (id) ON DELETE RESTRICT,
  type text NOT NULL
    CHECK (type IN ('deposit', 'withdraw', 'payment', 'refund', 'earning', 'commission', 'adjustment')),
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  reference_id text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ervenow_ledger_tx_wallet_created
  ON public.ervenow_ledger_transactions (wallet_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ervenow_ledger_tx_completed_ref
  ON public.ervenow_ledger_transactions (wallet_id, reference_id)
  WHERE reference_id IS NOT NULL AND status = 'completed';

-- ─── 3) settlement_log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settlement_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('order', 'service_booking', 'withdraw_request', 'other')),
  settlement_kind text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT settlement_log_entity_kind_unique UNIQUE (entity_id, entity_type, settlement_kind)
);

CREATE INDEX IF NOT EXISTS idx_settlement_log_entity
  ON public.settlement_log (entity_id, entity_type);

-- ─── 4) طلبات السحب (ledger) ───────────────────────────────────────────────
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

-- توافق مع مسارات /api/wallet التي تكتب ervenow_withdraw_requests
CREATE TABLE IF NOT EXISTS public.ervenow_withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  iban text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  note text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ervenow_withdraw_user
  ON public.ervenow_withdraw_requests (user_id, status);

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

CREATE OR REPLACE FUNCTION public.settlement_log_try_claim(
  p_entity_id uuid,
  p_entity_type text,
  p_settlement_kind text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_id IS NULL OR coalesce(trim(p_entity_type), '') = '' OR coalesce(trim(p_settlement_kind), '') = '' THEN
    RETURN false;
  END IF;
  INSERT INTO public.settlement_log (entity_id, entity_type, settlement_kind, metadata)
  VALUES (p_entity_id, p_entity_type, p_settlement_kind, coalesce(p_metadata, '{}'::jsonb));
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END;
$$;

-- ─── 6) تسوية طلب مُسلَّم + خدمة ───────────────────────────────────────────
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

  driver_component := round(coalesce(nullif(o.driver_earning, 0), nullif(o.delivery_fee, 0), 0)::numeric, 2);
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
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_booking_id');
  END IF;

  SELECT * INTO b
  FROM public.orders
  WHERE id = p_booking_id AND order_type IN ('service', 'gas_delivery')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  END IF;

  IF lower(coalesce(b.delivery_status, '')) NOT IN ('delivered', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivered');
  END IF;

  IF coalesce(b.provider_id, b.service_provider_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_provider');
  END IF;

  v_comm := round(coalesce(b.platform_commission, b.platform_fee, 0)::numeric, 2);
  IF v_comm <= 0 THEN
    v_comm := round(coalesce(b.total_amount, b.order_total, 0)::numeric * 0.07, 2);
  END IF;
  IF v_comm <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'skip_zero');
  END IF;

  v_ref := 'booking:' || p_booking_id::text || ':service_commission';

  IF EXISTS (
    SELECT 1 FROM public.ervenow_ledger_transactions t
    WHERE t.reference_id = v_ref AND t.status = 'completed' LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate', 'commission', v_comm);
  END IF;

  SELECT w.id INTO wid_platform FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true LIMIT 1;
  IF wid_platform IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  END IF;

  wid_provider := public.ervenow_ledger_ensure_wallet(coalesce(b.provider_id, b.service_provider_id), 'service');

  PERFORM public.ervenow_ledger_append_completed(
    wid_platform, 'commission', 'credit', v_comm, v_ref, 'عمولة منصة — خدمة'
  );
  PERFORM public.ervenow_ledger_append_completed(
    wid_provider, 'commission', 'debit', v_comm, v_ref, 'عمولة منصة — خدمة'
  );

  RETURN jsonb_build_object('ok', true, 'commission', v_comm);
END;
$$;

-- ─── 7) سحب — withdraw_requests (يستخدمه الأدمن) ───────────────────────────
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

  INSERT INTO public.ervenow_ledger_transactions (
    wallet_id, type, direction, amount, status, reference_id, description
  ) VALUES (wid, 'withdraw', 'debit', amt, 'completed', ref, 'سحب — موافقة إدارية');

  UPDATE public.withdraw_requests
  SET status = 'approved', processed_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'approved', 'amount', amt);
EXCEPTION WHEN unique_violation THEN
  UPDATE public.withdraw_requests SET status = 'approved', processed_at = coalesce(processed_at, now())
  WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'already_processed');
END;
$$;

CREATE OR REPLACE FUNCTION public.ervenow_ledger_withdraw_atomic(p_withdraw_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.ledger_withdraw_request_approve(p_withdraw_request_id);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.ervenow_ledger_credit(
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_role text DEFAULT NULL
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
  v_ref := 'order:' || trim(p_reference) || ':provider_credit';

  RETURN public.ervenow_ledger_append_completed(
    wid, 'earning', 'credit', round(p_amount::numeric, 2), v_ref, 'أرباح مزود — تسليم طلب'
  );
END;
$$;

-- ─── 8) بذرة محفظة المنصة ──────────────────────────────────────────────────
INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
SELECT NULL, 'platform', true, 0, 'SAR'
WHERE NOT EXISTS (SELECT 1 FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true);

-- ─── 9) محافظ تلقائية من orders (مزود / مندوب / تاجر) ─────────────────────
DO $$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RAISE NOTICE '[bootstrap] public.orders missing — skip wallet backfill from orders';
    RETURN;
  END IF;

  INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
  SELECT DISTINCT o.provider_id, public.ervenow_ledger_map_user_role(u.role), false, 0, 'SAR'
  FROM public.orders o
  JOIN public.users u ON u.id = o.provider_id
  WHERE o.provider_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ervenow_ledger_wallets w
      WHERE w.user_id = o.provider_id AND w.role = public.ervenow_ledger_map_user_role(u.role)
    );

  INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
  SELECT DISTINCT o.driver_id, 'driver', false, 0, 'SAR'
  FROM public.orders o
  WHERE o.driver_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ervenow_ledger_wallets w
      WHERE w.user_id = o.driver_id AND w.role = 'driver'
    );

  INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
  SELECT DISTINCT o.merchant_id, public.ervenow_ledger_map_user_role(u.role), false, 0, 'SAR'
  FROM public.orders o
  JOIN public.users u ON u.id = o.merchant_id
  WHERE o.merchant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ervenow_ledger_wallets w
      WHERE w.user_id = o.merchant_id AND w.role = public.ervenow_ledger_map_user_role(u.role)
    );
END $$;

-- ─── 10) RLS + صلاحيات ─────────────────────────────────────────────────────
ALTER TABLE public.ervenow_ledger_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ervenow_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdraw_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ervenow_withdraw_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ervenow_ledger_wallets_service" ON public.ervenow_ledger_wallets;
CREATE POLICY "ervenow_ledger_wallets_service" ON public.ervenow_ledger_wallets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ervenow_ledger_tx_service" ON public.ervenow_ledger_transactions;
CREATE POLICY "ervenow_ledger_tx_service" ON public.ervenow_ledger_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "settlement_log_service" ON public.settlement_log;
CREATE POLICY "settlement_log_service" ON public.settlement_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "withdraw_requests_service" ON public.withdraw_requests;
CREATE POLICY "withdraw_requests_service" ON public.withdraw_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.ervenow_ledger_wallets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ervenow_ledger_transactions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.settlement_log TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.withdraw_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ervenow_withdraw_requests TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_map_user_role(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_ensure_wallet(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_append_completed(uuid, text, text, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_recalc_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_wallet_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_deposit(uuid, text, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_pay(uuid, numeric, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_refund(uuid, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_settle_delivered_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_settle_service_booking(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settlement_log_try_claim(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_withdraw_request_approve(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_withdraw_atomic(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_user_wallet_summary(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_credit(uuid, numeric, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ─── 11) تقرير بعد التنفيذ ─────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.ervenow_ledger_wallets) AS ledger_wallets,
  (SELECT count(*) FROM public.ervenow_ledger_wallets WHERE is_platform = true) AS platform_wallets,
  (SELECT count(*) FROM public.ervenow_ledger_transactions) AS ledger_transactions,
  (SELECT count(*) FROM public.settlement_log) AS settlement_log_rows,
  (SELECT count(*) FROM public.withdraw_requests) AS withdraw_requests,
  (SELECT count(*) FROM public.ervenow_withdraw_requests) AS ervenow_withdraw_requests;
