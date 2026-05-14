-- وسائل الدفع في السلة: ew_pay, mada, visa, mastercard, apple_pay, stc_pay, cash_on_delivery, tabby, tamara
-- نفّذ في Supabase SQL Editor بعد migration_platform_settings.sql و migration_store_merchant_hub.sql

INSERT INTO public.platform_settings (key, value, updated_at)
VALUES (
  'checkout_payment_methods',
  '{"ew_pay":true,"mada":true,"visa":true,"mastercard":true,"apple_pay":true,"stc_pay":true,"cash_on_delivery":true,"tabby":true,"tamara":true}',
  now()
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.store_merchant_hub
  ADD COLUMN IF NOT EXISTS checkout_payment_methods jsonb;

COMMENT ON COLUMN public.store_merchant_hub.checkout_payment_methods IS 'تعطيل وسائل عن المنصة: {"visa":false} — null يعني قبول كل ما تسمح به المنصة';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS checkout_payment_methods jsonb;

COMMENT ON COLUMN public.users.checkout_payment_methods IS 'لمزودي الخدمة (role=service): تعطيل وسائل عن المنصة — null = كل ما تسمح به المنصة';
