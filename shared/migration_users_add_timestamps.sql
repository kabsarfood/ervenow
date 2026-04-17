-- إصلاح: Could not find the 'updated_at' column of 'users' in the schema cache
-- نفّذ في Supabase → SQL Editor → Run مرة واحدة.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- بعد التنفيذ، انتظر بضع ثوانٍ حتى يحدّث PostgREST ذاكرة المخطط، ثم أعد محاولة تسجيل الدخول.
