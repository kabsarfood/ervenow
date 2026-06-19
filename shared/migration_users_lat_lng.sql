-- موقع مزوّد الخدمة (للنطاق الجغرافي / غاز / تتبع)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

CREATE INDEX IF NOT EXISTS users_service_lat_lng_idx
  ON public.users (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
