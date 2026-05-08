-- ERVENOW: منع تكرار هوية المندوب وجوال المتجر + بصمة آيبان للتحقق والسحب
-- نفّذ في Supabase بعد migration_bank_drivers_stores_secure.sql
-- إن فشل فهرس الجوال بسبب بيانات مكررة قديماً: نظّف التكرار ثم أعد التنفيذ.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS iqama_digits text,
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

UPDATE public.drivers
SET iqama_digits = regexp_replace(coalesce(iqama, ''), '\D', '', 'g')
WHERE (iqama_digits IS NULL OR btrim(iqama_digits) = '')
  AND coalesce(btrim(iqama), '') <> '';

COMMENT ON COLUMN public.drivers.iqama_digits IS 'أرقام الهوية/الإقامة فقط — فهرس فريد';
COMMENT ON COLUMN public.drivers.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — منع تعدد الجهات';
COMMENT ON COLUMN public.stores.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع)';
COMMENT ON COLUMN public.users.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_iqama_digits
  ON public.drivers (iqama_digits)
  WHERE iqama_digits IS NOT NULL AND length(iqama_digits) >= 8;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_phone_pending_approved
  ON public.stores (phone)
  WHERE status IN ('pending', 'approved');

NOTIFY pgrst, 'reload schema';
