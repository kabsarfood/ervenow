-- Allow car polishing provider registration on users.service_type
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_service_type_check;

ALTER TABLE public.users ADD CONSTRAINT users_service_type_check CHECK (
  service_type IS NULL OR service_type IN (
    'plumber',
    'electrician',
    'nursery',
    'agricultural_engineer',
    'ac_technician',
    'cleaning',
    'cleaning_villa',
    'cleaning_building',
    'laundry_estates',
    'vehicle_transfer',
    'internal_delivery',
    'pickup_truck',
    'furniture_move',
    'gas_delivery',
    'gas_cylinder_swap',
    'gas_central_refill',
    'car_polishing',
    'car_transport'
  )
);
