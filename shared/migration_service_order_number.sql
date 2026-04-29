ALTER TABLE public.service_bookings
ADD COLUMN IF NOT EXISTS service_order_number text;

CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_order_number_key
ON public.service_bookings (service_order_number)
WHERE service_order_number IS NOT NULL;
