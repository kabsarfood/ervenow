-- =============================================================================
-- ERVENOW Database Refactor — Phase 1: Ledger as canonical financial source
-- Safe / idempotent — run in Supabase SQL Editor after migration_unified_finance_ledger.sql
-- =============================================================================

COMMENT ON TABLE public.ervenow_ledger_wallets IS
  'CANONICAL — unified ledger wallets; balance derived from completed ervenow_ledger_transactions only';

COMMENT ON TABLE public.ervenow_ledger_transactions IS
  'CANONICAL — unified ledger movements; every financial event must use a unique reference_id per wallet when completed';

-- Alias index (same semantics as uq_ervenow_ledger_tx_completed_ref from unified migration)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unique_ref
  ON public.ervenow_ledger_transactions (wallet_id, reference_id)
  WHERE reference_id IS NOT NULL AND status = 'completed';

COMMENT ON INDEX public.idx_ledger_unique_ref IS
  'Prevents duplicate completed ledger postings per wallet + reference_id (order, booking, withdraw, etc.)';

-- Helper: document expected reference_id prefixes (enforced in application/RPC, not DB CHECK)
COMMENT ON COLUMN public.ervenow_ledger_transactions.reference_id IS
  'Idempotency key, e.g. order:{uuid}:commission, order:{uuid}:earning, withdraw:{uuid}, pay:order:{uuid}, wreq:{uuid}';

CREATE INDEX IF NOT EXISTS idx_ervenow_ledger_wallets_user_id
  ON public.ervenow_ledger_wallets (user_id)
  WHERE user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
