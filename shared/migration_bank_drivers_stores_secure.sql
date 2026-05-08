-- ERVENOW: حقول حساب بنكي كاملة + توافق PostgREST (schema cache)
-- نفّذ في Supabase SQL Editor بعد: shared/migration_drivers.sql و migration_payout_registration.sql
-- يضيف الأعمدة الناقصة (مثل bank_country_code إن لم تُنفَّذ الهجرة السابقة) وحقول التخزين الآمن bank_*

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_swift_code text,
  ADD COLUMN IF NOT EXISTS bank_last4 text,
  ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_added_at timestamptz DEFAULT now();

COMMENT ON COLUMN public.drivers.bank_last4 IS 'آخر 4 أحرف/أرقام للعرض فقط (بدون تخزين الآيبان كاملاً)';
COMMENT ON COLUMN public.drivers.bank_iban IS 'آيبان مشفّر (تطبيق الخادم — AES-256-CBC)';

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_swift_code text,
  ADD COLUMN IF NOT EXISTS bank_last4 text,
  ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_added_at timestamptz DEFAULT now();

COMMENT ON COLUMN public.stores.bank_last4 IS 'آخر 4 أحرف/أرقام للعرض فقط';
COMMENT ON COLUMN public.stores.bank_iban IS 'آيبان مشفّر (تطبيق الخادم)';

NOTIFY pgrst, 'reload schema';
