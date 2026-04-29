ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_type text;

CREATE INDEX IF NOT EXISTS users_service_type_idx ON public.users (service_type);
