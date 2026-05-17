ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_district text;

CREATE INDEX IF NOT EXISTS users_service_district_idx ON public.users (service_district);

ALTER TABLE public.service_bookings
ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
