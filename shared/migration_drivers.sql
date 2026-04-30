CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  phone text UNIQUE,
  iqama text,
  car_type text,
  plate_number text,
  status text DEFAULT 'pending',
  active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drivers_status_idx ON public.drivers (status);
CREATE INDEX IF NOT EXISTS drivers_active_idx ON public.drivers (active);
