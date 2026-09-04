-- OTP consumed_at + فهارس IP — آمن للإعادة
ALTER TABLE public.ervenow_otp_challenges
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ervenow_otp_ip_last_sent
  ON public.ervenow_otp_challenges (ip, last_sent_at DESC)
  WHERE ip IS NOT NULL;

NOTIFY pgrst, 'reload schema';
