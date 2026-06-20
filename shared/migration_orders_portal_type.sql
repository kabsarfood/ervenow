-- ERVENOW Flow Separation 3.0 — Order portal_type
-- portal_type: merchant | service | transport | driver

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS portal_type text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_portal_type_check'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_portal_type_check;
  END IF;
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_portal_type_check
    CHECK (portal_type IS NULL OR portal_type IN ('merchant', 'service', 'transport', 'driver'));
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_portal_type ON public.orders (portal_type);

COMMENT ON COLUMN public.orders.portal_type IS
  'ERVENOW Flow 3.0 — owner portal: merchant | service | transport | driver';

-- Backfill from order_type + service_type heuristics
UPDATE public.orders o
SET portal_type = CASE
  WHEN o.service_type = 'internal_delivery' THEN 'driver'
  WHEN o.order_type IN ('service', 'gas_delivery') THEN
    CASE
      WHEN o.service_type IN (
        'pickup_truck', 'car_transport', 'vehicle_transfer', 'furniture_move'
      ) THEN 'transport'
      WHEN o.service_type IN (
        'gas_cylinder_swap', 'gas_central_refill', 'gas_delivery'
      ) OR o.order_type = 'gas_delivery' THEN 'service'
      ELSE 'service'
    END
  WHEN o.order_type IN ('store', 'restaurant', 'delivery') THEN 'merchant'
  ELSE 'merchant'
END
WHERE o.portal_type IS NULL
   OR o.portal_type = 'transport' AND o.service_type IN ('internal_delivery', 'gas_cylinder_swap', 'gas_central_refill', 'gas_delivery')
   OR o.portal_type = 'transport' AND o.order_type = 'gas_delivery';

-- Reclassify legacy misrouted rows (G1-R Final Freeze)
UPDATE public.orders
SET portal_type = 'driver'
WHERE service_type = 'internal_delivery' AND portal_type IS DISTINCT FROM 'driver';

UPDATE public.orders
SET portal_type = 'service'
WHERE (
  service_type IN ('gas_cylinder_swap', 'gas_central_refill', 'gas_delivery')
  OR order_type = 'gas_delivery'
) AND portal_type IS DISTINCT FROM 'service';
