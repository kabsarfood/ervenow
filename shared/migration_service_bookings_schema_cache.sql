-- =============================================================================
-- ERVENOW — أعمدة service_bookings (idempotent) لإصلاح:
--   Could not find the 'customer_phone' column of 'service_bookings' in the schema cache
-- نفّذ في Supabase → SQL Editor (مرة واحدة)
-- =============================================================================

ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS qty integer DEFAULT 1;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS platform_commission numeric DEFAULT 0;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS service_order_number text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.users(id);
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS rating integer;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS review text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS rated_at timestamptz;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS gas_mode text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS gas_liters integer;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS commission_settled boolean DEFAULT false;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS commission_due boolean DEFAULT false;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS commission_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_order_number_key
  ON public.service_bookings (service_order_number)
  WHERE service_order_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_bookings_status_idx ON public.service_bookings (status);
CREATE INDEX IF NOT EXISTS service_bookings_type_idx ON public.service_bookings (service_type);
CREATE INDEX IF NOT EXISTS service_bookings_created_idx ON public.service_bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS service_bookings_gas_mode_idx ON public.service_bookings (gas_mode);

NOTIFY pgrst, 'reload schema';
