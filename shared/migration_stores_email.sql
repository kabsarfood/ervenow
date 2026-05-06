-- عمود البريد على stores (قد يكون مفقوداً في قواعد قديمة أو قبل إعادة تحميل مخطط PostgREST)
-- نفّذ في Supabase → SQL Editor بعد migration_stores.sql عند ظهور:
--   Could not find the 'email' column of 'stores' in the schema cache
-- ثم من لوحة Supabase: Settings → API → «Reload schema» (أو إعادة تشغيل المشروع) لتحديث الكاش.

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.stores.email IS 'بريد المتجر (اختياري) — طلب التسجيل';
