ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric,
  ADD COLUMN IF NOT EXISTS last_seen timestamptz;

CREATE INDEX IF NOT EXISTS drivers_active_status_idx ON public.drivers (active, status);
