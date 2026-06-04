-- =============================================================================
-- ERVENOW DELIVERY ENGINE 1.0
-- سياسة التوصيل للمتجر + منتج شامل التوصيل + OTP استلام المتجر
-- =============================================================================

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS delivery_policy text NOT NULL DEFAULT 'ervenow_delivery';
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS free_delivery_policy text NOT NULL DEFAULT 'none';
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS free_delivery_min_order numeric;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS free_delivery_radius_km numeric;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS delivery_fee_per_km numeric NOT NULL DEFAULT 2.3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_delivery_policy_check'
  ) THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_delivery_policy_check CHECK (
      delivery_policy IN (
        'pickup_only',
        'store_delivery',
        'ervenow_delivery',
        'store_plus_ervenow'
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_free_delivery_policy_check'
  ) THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_free_delivery_policy_check CHECK (
      free_delivery_policy IN ('none', 'always', 'min_order', 'radius')
    );
  END IF;
END $$;

ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS includes_delivery boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stores.delivery_policy IS 'pickup_only | store_delivery | ervenow_delivery | store_plus_ervenow';
COMMENT ON COLUMN public.stores.free_delivery_policy IS 'none | always | min_order | radius';
COMMENT ON COLUMN public.store_products.includes_delivery IS 'المنتج يشمل التوصيل مجاناً';

CREATE TABLE IF NOT EXISTS public.order_receipt_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_receipt_otps_order_id ON public.order_receipt_otps (order_id);
