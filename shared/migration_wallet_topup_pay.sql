-- =============================================================================
-- ERVENOW PAY — طلبات شحن STC Pay + أكواد واتساب + إعدادات platform_settings
-- نفّذ في Supabase SQL Editor
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wallet_topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  phone text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  proof_image text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_requests_user
  ON public.wallet_topup_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_requests_status
  ON public.wallet_topup_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wallet_topup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  phone text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.wallet_topup_requests (id) ON DELETE SET NULL,
  is_used boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_codes_user
  ON public.wallet_topup_codes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_codes_phone
  ON public.wallet_topup_codes (phone);

-- ——— استرداد كود شحن (ذري) ———
CREATE OR REPLACE FUNCTION public.ervenow_redeem_topup_code(
  p_user_id uuid,
  p_role text,
  p_code text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.wallet_topup_codes%ROWTYPE;
  norm_user_phone text;
  norm_code_phone text;
  dep jsonb;
  ledger_role text;
BEGIN
  IF p_user_id IS NULL OR coalesce(trim(p_code), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  SELECT * INTO c
  FROM public.wallet_topup_codes
  WHERE upper(trim(code)) = upper(trim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found');
  END IF;

  IF c.is_used THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_already_used');
  END IF;

  IF c.expires_at IS NOT NULL AND c.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_expired');
  END IF;

  norm_user_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  norm_code_phone := regexp_replace(coalesce(c.phone, ''), '\D', '', 'g');

  IF c.user_id IS DISTINCT FROM p_user_id
     AND (norm_user_phone = '' OR norm_code_phone = '' OR norm_user_phone <> norm_code_phone) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_not_for_user');
  END IF;

  UPDATE public.wallet_topup_codes
  SET is_used = true, used_at = now()
  WHERE id = c.id AND is_used = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_already_used');
  END IF;

  ledger_role := public.ervenow_ledger_map_user_role(coalesce(nullif(trim(p_role), ''), 'customer'));

  dep := public.ervenow_ledger_deposit(
    p_user_id,
    ledger_role,
    c.amount,
    'topup:code:' || c.code,
    'شحن رصيد — كود STC Pay'
  );

  IF coalesce(dep->>'ok', 'false') NOT IN ('true', 't') THEN
    UPDATE public.wallet_topup_codes
    SET is_used = false, used_at = NULL
    WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'reason', coalesce(dep->>'reason', 'deposit_failed'), 'deposit', dep);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'amount', c.amount,
    'code', c.code,
    'deposit', dep
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ervenow_redeem_topup_code(uuid, text, text, text) TO service_role;

-- ——— إعدادات ERVENOW PAY ———
INSERT INTO public.platform_settings (key, value, type, description, updated_at)
VALUES
  ('wallet_topup_enabled', 'true', 'boolean', 'تفعيل شحن المحفظة', now()),
  ('wallet_withdraw_enabled', 'false', 'boolean', 'تفعيل السحب', now()),
  ('wallet_transfer_enabled', 'false', 'boolean', 'تفعيل التحويل بين المستخدمين', now()),
  ('payment_gateways_enabled', 'false', 'boolean', 'تفعيل بوابات الدفع الخارجية', now()),
  ('stcpay_enabled', 'true', 'boolean', 'تفعيل STC Pay للشحن', now()),
  ('mada_enabled', 'false', 'boolean', 'تفعيل مدى', now()),
  ('visa_enabled', 'false', 'boolean', 'تفعيل Visa', now()),
  ('min_topup_amount', '30', 'number', 'الحد الأدنى للشحن (ر.س)', now()),
  ('max_topup_amount', '5000', 'number', 'الحد الأعلى للشحن (ر.س)', now()),
  ('stcpay_display_number', '0500000000', 'string', 'رقم STC Pay للتحويل', now())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.wallet_topup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_topup_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_topup_requests_service ON public.wallet_topup_requests;
CREATE POLICY wallet_topup_requests_service ON public.wallet_topup_requests
  FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS wallet_topup_codes_service ON public.wallet_topup_codes;
CREATE POLICY wallet_topup_codes_service ON public.wallet_topup_codes
  FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
