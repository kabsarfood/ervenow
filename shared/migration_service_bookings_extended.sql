ALTER TABLE public.service_bookings
ADD COLUMN IF NOT EXISTS service_type text,
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS district text,
ADD COLUMN IF NOT EXISTS location text,
ADD COLUMN IF NOT EXISTS qty integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS platform_commission numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS service_bookings_status_idx ON public.service_bookings (status);
CREATE INDEX IF NOT EXISTS service_bookings_type_idx ON public.service_bookings (service_type);
CREATE INDEX IF NOT EXISTS service_bookings_created_idx ON public.service_bookings (created_at DESC);
