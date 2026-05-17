-- بيانات مركبة مقدّم خدمة السطحية (سائق سطحى)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_vehicle_type text;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_plate_number text;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS service_vehicle_model text;
