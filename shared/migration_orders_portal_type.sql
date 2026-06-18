-- ERVENOW Flow Separation 3.0 — Order portal_type
-- portal_type: merchant | service | transport

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS portal_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_portal_type_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_portal_type_check
      CHECK (portal_type IS NULL OR portal_type IN ('merchant', 'service', 'transport'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_portal_type ON public.orders (portal_type);

COMMENT ON COLUMN public.orders.portal_type IS
  'ERVENOW Flow 3.0 — owner portal: merchant | service | transport';

-- Backfill from order_type + service_type heuristics
UPDATE public.orders o
SET portal_type = CASE
  WHEN o.order_type IN ('service', 'gas_delivery') THEN
    CASE
      WHEN o.service_type IN (
        'pickup_truck', 'car_transport', 'vehicle_transfer', 'internal_delivery',
        'furniture_move', 'gas_cylinder_swap', 'gas_central_refill', 'gas_delivery'
      ) THEN 'transport'
      ELSE 'service'
    END
  WHEN o.order_type IN ('store', 'restaurant', 'delivery') THEN 'merchant'
  ELSE 'merchant'
END
WHERE o.portal_type IS NULL;
