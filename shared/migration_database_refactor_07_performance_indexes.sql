-- =============================================================================
-- ERVENOW Database Refactor — Phase 7: Performance indexes (idempotent)
-- Note: ervenow_ledger_transactions has wallet_id (not user_id); user lookups use wallets index
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON public.orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_driver
  ON public.orders (driver_id)
  WHERE driver_id IS NOT NULL;

-- Alias / complement to migration_orders_performance_indexes.sql
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status_created
  ON public.orders (delivery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_tx_wallet_created
  ON public.ervenow_ledger_transactions (wallet_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
