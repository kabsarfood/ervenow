-- =============================================================================
-- ERVENOW Database Refactor — Phase 8: Mark legacy accounting tables (no drops)
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.wallets') IS NOT NULL THEN
    COMMENT ON TABLE public.wallets IS
      'LEGACY accounting MVP — transitional; canonical balances: ervenow_ledger_*';
  END IF;
  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    COMMENT ON TABLE public.wallet_transactions IS
      'LEGACY accounting MVP — transitional; canonical movements: ervenow_ledger_transactions';
  END IF;
  IF to_regclass('public.withdrawals') IS NOT NULL THEN
    COMMENT ON TABLE public.withdrawals IS
      'LEGACY — linked to wallets.id; use ervenow_withdraw_requests + ledger for new flows';
  END IF;
  IF to_regclass('public.ervenow_wallets') IS NOT NULL THEN
    COMMENT ON TABLE public.ervenow_wallets IS
      'TRANSITIONAL operational wallet — migrate reads to ervenow_ledger_wallets over time';
  END IF;
  IF to_regclass('public.ervenow_wallet_transactions') IS NOT NULL THEN
    COMMENT ON TABLE public.ervenow_wallet_transactions IS
      'TRANSITIONAL operational tx — migrate to ervenow_ledger_transactions over time';
  END IF;
  IF to_regclass('public.driver_wallets') IS NOT NULL THEN
    COMMENT ON TABLE public.driver_wallets IS
      'ACTIVE COD commission balance — parallel to ledger until unified product policy';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
