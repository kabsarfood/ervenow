-- نفّذ في Supabase SQL Editor بعد migration_users_service_type.sql
-- يخزّن المدينة/الحي لمقدّمي الخدمة (سطحة، سباك، …)

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_district text;

CREATE INDEX IF NOT EXISTS users_service_district_idx ON public.users (service_district);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_bookings'
  ) THEN
    ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
  END IF;
END $$;
