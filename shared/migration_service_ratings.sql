ALTER TABLE public.service_bookings
ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.users (id),
ADD COLUMN IF NOT EXISTS rating integer,
ADD COLUMN IF NOT EXISTS review text,
ADD COLUMN IF NOT EXISTS rated_at timestamptz;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_rating_avg numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS service_rating_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS service_bookings_provider_idx ON public.service_bookings (provider_id);
CREATE INDEX IF NOT EXISTS service_bookings_rating_idx ON public.service_bookings (rating);
