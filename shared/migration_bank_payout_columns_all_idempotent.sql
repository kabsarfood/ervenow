-- =============================================================================
-- ERVENOW — migration_bank_payout_columns_all_idempotent.sql
-- =============================================================================
-- دفعة واحدة: كل أعمدة الدفع/البنك التي يتوقعها التطبيق (users / drivers / stores)
-- آمنة عند إعادة التشغيل: ALTER TABLE IF EXISTS + ADD COLUMN IF NOT EXISTS
--
-- متى تستخدمها: بعد أخطاء PostgREST مثل «bank_added_at ... schema cache» أو لتجنب
-- تنفيذ هجرات متفرقة. يمكن تنفيذها حتى لو نُفِّذت migration_payout_registration.sql
-- أو migration_bank_drivers_stores_secure.sql سابقاً (لا تعيد إنشاء أعمدة موجودة).
--
-- الفهارس الفريدة (iqama_digits، payout_iban_fingerprint، …): نفّذ إن لزم:
--   shared/migration_payout_uniqueness.sql
-- =============================================================================

-- ——— users (تسجيل عميل + محفظة + مزامنة آيبان من تسجيل المندوب) ———
ALTER TABLE IF EXISTS public.users
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS stc_pay_phone text,
  ADD COLUMN IF NOT EXISTS payout_crypto_interest boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

COMMENT ON COLUMN public.users.bank_country_code IS 'رمز الدولة لقائمة البنوك (حالياً SA)';
COMMENT ON COLUMN public.users.stc_pay_phone IS 'جوال STC Pay اختياري 05xxxxxxxx';
COMMENT ON COLUMN public.users.payout_crypto_interest IS 'موافقة مبدئية على استلام مستقبلي بالعملات المشفرة';
COMMENT ON COLUMN public.users.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — بصمة للتحقق داخل users';

-- ——— drivers (تسجيل مندوب: payoutFields.js + driver/routes.js) ———
ALTER TABLE IF EXISTS public.drivers
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS stc_pay_phone text,
  ADD COLUMN IF NOT EXISTS payout_crypto_interest boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_swift_code text,
  ADD COLUMN IF NOT EXISTS bank_last4 text,
  ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_added_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS iqama_digits text,
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

COMMENT ON COLUMN public.drivers.bank_last4 IS 'آخر 4 أحرف/أرقام للعرض فقط (بدون تخزين الآيبان كاملاً)';
COMMENT ON COLUMN public.drivers.bank_iban IS 'آيبان مشفّر (تطبيق الخادم — AES-256-CBC)';
COMMENT ON COLUMN public.drivers.iban IS 'قديم/اختياري — التطبيق يفضّل bank_iban المشفّر';
COMMENT ON COLUMN public.drivers.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — بصمة داخل drivers';

-- ——— stores (لوحة المتجر + payoutFields) ———
ALTER TABLE IF EXISTS public.stores
  ADD COLUMN IF NOT EXISTS bank_country_code text DEFAULT 'SA',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS stc_pay_phone text,
  ADD COLUMN IF NOT EXISTS payout_crypto_interest boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_swift_code text,
  ADD COLUMN IF NOT EXISTS bank_last4 text,
  ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_added_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payout_iban_fingerprint text;

COMMENT ON COLUMN public.stores.bank_last4 IS 'آخر 4 أحرف/أرقام للعرض فقط';
COMMENT ON COLUMN public.stores.bank_iban IS 'آيبان مشفّر (تطبيق الخادم)';
COMMENT ON COLUMN public.stores.payout_iban_fingerprint IS 'SHA256(IBAN بعد التطبيع) — بصمة داخل stores';

NOTIFY pgrst, 'reload schema';
