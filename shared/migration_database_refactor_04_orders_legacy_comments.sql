-- =============================================================================
-- ERVENOW Database Refactor — Phase 4: Document legacy order tables/columns (no drops)
-- =============================================================================

COMMENT ON TABLE public.delivery_orders IS
  'LEGACY — NOT USED by ERVENOW Node app; canonical delivery data is public.orders';

COMMENT ON COLUMN public.orders.delivery_order_id IS
  'LEGACY LINK — prefer orders.id; historical FK to delivery_orders; do not write new values';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'food_orders'
      AND column_name = 'delivery_order_id'
  ) THEN
    COMMENT ON COLUMN public.food_orders.delivery_order_id IS
      'LEGACY — may store orders.id despite FK name; do not use for new integrations';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
