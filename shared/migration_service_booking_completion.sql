-- ERVENOW — تأكيد مزدوج لإتمام حجز الخدمة (مزود + عميل)
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS provider_completed_at timestamptz;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS service_bookings_provider_completed_idx
  ON public.service_bookings (provider_completed_at)
  WHERE provider_completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_bookings_customer_confirmed_idx
  ON public.service_bookings (customer_confirmed_at)
  WHERE customer_confirmed_at IS NOT NULL;
