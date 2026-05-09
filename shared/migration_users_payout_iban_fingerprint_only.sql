-- إصلاح سريع: column users.payout_iban_fingerprint does not exist
-- نفّذ في Supabase → SQL Editor ثم أعد تحميل الـ schema إن لزم.
--
-- للمشروع الكامل (مندوبين + متاجر + فهارس): نفّذ بدلاً من ذلك أو بعدها:
--   shared/migration_payout_uniqueness.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

COMMENT ON COLUMN public.users.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — منع تعدد الجهات';

NOTIFY pgrst, 'reload schema';
