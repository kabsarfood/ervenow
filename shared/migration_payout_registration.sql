-- ERVENOW: حقول تعريف حساب بنكي / STC Pay / اهتمام بالعملات المشفرة عند التسجيل (مندوبين + متاجر)
-- نفّذ في Supabase SQL Editor بعد جداول users / drivers / stores

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS stc_pay_phone text,
  ADD COLUMN IF NOT EXISTS payout_crypto_interest boolean DEFAULT false;

COMMENT ON COLUMN public.users.bank_country_code IS 'رمز الدولة لقائمة البنوك (حالياً SA)';
COMMENT ON COLUMN public.users.stc_pay_phone IS 'جوال STC Pay اختياري 05xxxxxxxx';
COMMENT ON COLUMN public.users.payout_crypto_interest IS 'موافقة مبدئية على استلام مستقبلي بالعملات المشفرة عند توفر الخدمة';

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS stc_pay_phone text,
  ADD COLUMN IF NOT EXISTS payout_crypto_interest boolean DEFAULT false;

COMMENT ON COLUMN public.drivers.bank_name IS 'اسم البنك كما اختاره المندوب من القائمة أو نص حر';

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS stc_pay_phone text,
  ADD COLUMN IF NOT EXISTS payout_crypto_interest boolean DEFAULT false;
