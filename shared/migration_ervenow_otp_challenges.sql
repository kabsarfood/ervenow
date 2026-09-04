-- ERVENOW: تحديات OTP — تخزين في Supabase (متعدد النسخ، restart-safe)
-- نفّذ في Supabase SQL Editor قبل تعيين ERVENOW_OTP_BACKEND=supabase
-- بعد التنفيذ: NOTIFY pgrst إن لزم لتحديث الكاش.

CREATE TABLE IF NOT EXISTS public.ervenow_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  subject_key text NOT NULL,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  resend_count int NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  ip text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ervenow_otp_scope_subject_created
  ON public.ervenow_otp_challenges (scope, subject_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ervenow_otp_expires
  ON public.ervenow_otp_challenges (expires_at);

COMMENT ON TABLE public.ervenow_otp_challenges IS 'OTP challenges — استخدم مع ERVENOW_OTP_BACKEND=supabase و ERVENOW_OTP_PEPPER';

ALTER TABLE public.ervenow_otp_challenges ENABLE ROW LEVEL SECURITY;

-- لا سياسات للعميل المباشر — الوصول عبر service_role فقط من الخادم.
DROP POLICY IF EXISTS "ervenow_otp_no_direct_access" ON public.ervenow_otp_challenges;
CREATE POLICY "ervenow_otp_no_direct_access"
  ON public.ervenow_otp_challenges
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
