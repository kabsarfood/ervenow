-- =============================================================================
-- ERVENOW — Ledger Only Mode: block INSERT/UPDATE on legacy finance tables
-- Safe: no DROP — triggers reject new writes; reads may still exist until cleanup
-- Run after migration_database_refactor_01..08
-- Set FINANCE_MODE=ledger_only on Node server
-- =============================================================================

CREATE OR REPLACE FUNCTION public.block_legacy_finance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Legacy finance system disabled — use ervenow_ledger_wallets / ervenow_ledger_transactions only';
END;
$$;

COMMENT ON FUNCTION public.block_legacy_finance() IS
  'Ledger-only mode: rejects writes to transitional wallet tables';

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'wallets',
    'wallet_transactions',
    'withdrawals',
    'ervenow_wallets',
    'ervenow_wallet_transactions',
    'driver_wallets',
    'driver_ledger',
    'store_wallets',
    'store_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS prevent_%s_insert ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER prevent_%s_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.block_legacy_finance()',
        t, t
      );
      EXECUTE format('DROP TRIGGER IF EXISTS prevent_%s_update ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER prevent_%s_update BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.block_legacy_finance()',
        t, t
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
