-- =============================================================================
-- ترقية جداول ledger القديمة (إن وُجدت بأعمدة ناقصة)
-- =============================================================================

ALTER TABLE IF EXISTS public.ervenow_ledger_wallets
  ADD COLUMN IF NOT EXISTS is_platform boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.ervenow_ledger_wallets
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';

ALTER TABLE IF EXISTS public.ervenow_ledger_wallets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE IF EXISTS public.ervenow_ledger_transactions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.ervenow_ledger_transactions
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE IF EXISTS public.ervenow_ledger_transactions
  ADD COLUMN IF NOT EXISTS reference_id text;

ALTER TABLE IF EXISTS public.ervenow_ledger_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

UPDATE public.ervenow_ledger_transactions
SET status = 'completed'
WHERE status IS NULL OR trim(status) = '';

INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
SELECT NULL, 'platform', true, 0, 'SAR'
WHERE NOT EXISTS (SELECT 1 FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true);

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

CREATE TABLE IF NOT EXISTS public.ervenow_withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  note text,
  iban text
);
