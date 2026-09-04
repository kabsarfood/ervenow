-- حقول تسجيل مسبق للعملاء — اختيارية
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS acquisition_source text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS utm_source text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS utm_medium text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS utm_campaign text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS utm_content text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gclid text;

CREATE INDEX IF NOT EXISTS idx_users_phone_verified_at ON public.users (phone_verified_at)
  WHERE phone_verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_created ON public.users (role, created_at DESC);

NOTIFY pgrst, 'reload schema';
