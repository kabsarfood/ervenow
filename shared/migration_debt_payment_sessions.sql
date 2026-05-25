-- جلسات سداد الديون (Pay Link + بوابة الدفع)
-- نفّذ في Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.debt_payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'SAR',
  pay_type text NOT NULL DEFAULT 'debt',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  gateway text NOT NULL DEFAULT 'moyasar',
  gateway_payment_id text,
  gateway_invoice_id text,
  checkout_url text,
  settlement jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS debt_payment_sessions_user_created_idx
  ON public.debt_payment_sessions (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_payment_sessions_gateway_payment
  ON public.debt_payment_sessions (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

COMMENT ON TABLE public.debt_payment_sessions IS 'جلسات سداد مستحقات (Pay Link) — مرتبطة ببوابة الدفع';

GRANT SELECT, INSERT, UPDATE ON public.debt_payment_sessions TO service_role;
