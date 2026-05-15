-- =============================================================================
-- ERVENOW — إصلاح:
--   Could not find the table 'public.ervenow_withdraw_requests' in the schema cache
--
-- نفّذ في Supabase → SQL Editor (مرة واحدة).
-- يعتمد على وجود جدول public.users.
-- للمحفظة الكاملة + RPC السحب الذرّي نفّذ أيضاً:
--   shared/migration_ervenow_wallet_payouts.sql
--   shared/migration_ervenow_wallet_atomic_v2.sql
-- =============================================================================

-- أعمدة اختيارية على users (للسحب)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS iban text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bank_name text;

-- محفظة تشغيلية (مطلوبة عند موافقة الأدمن على السحب)
CREATE TABLE IF NOT EXISTS public.ervenow_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role text,
  balance numeric(12, 2) NOT NULL DEFAULT 0,
  total_earned numeric(12, 2) NOT NULL DEFAULT 0,
  total_withdrawn numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_ervenow_wallets_user ON public.ervenow_wallets (user_id);

-- طلبات السحب
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

CREATE INDEX IF NOT EXISTS idx_ervenow_withdraw_created
  ON public.ervenow_withdraw_requests (created_at DESC);

-- حركات المحفظة (إن لم تكن موجودة)
CREATE TABLE IF NOT EXISTS public.ervenow_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  type text NOT NULL CHECK (type IN ('earning', 'withdraw')),
  reference_id uuid,
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ervenow_wallet_tx_earning_per_order
  ON public.ervenow_wallet_transactions (reference_id)
  WHERE type = 'earning' AND reference_id IS NOT NULL;

ALTER TABLE public.ervenow_wallet_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
  CHECK (status IN ('pending', 'completed', 'failed'));

-- RLS (الخادم يستخدم service role؛ السياسات للوصول عبر Supabase Auth إن وُجد)
ALTER TABLE public.ervenow_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ervenow_withdraw_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ervenow_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ervenow_wallets_service" ON public.ervenow_wallets;
CREATE POLICY "ervenow_wallets_service" ON public.ervenow_wallets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ervenow_withdraw_service" ON public.ervenow_withdraw_requests;
CREATE POLICY "ervenow_withdraw_service" ON public.ervenow_withdraw_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ervenow_wtx_service" ON public.ervenow_wallet_transactions;
CREATE POLICY "ervenow_wtx_service" ON public.ervenow_wallet_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
