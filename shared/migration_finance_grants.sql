-- صلاحيات و RLS لجدول ledger (بعد إنشاء الجداول)

ALTER TABLE IF EXISTS public.ervenow_ledger_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ervenow_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settlement_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF to_regclass('public.withdraw_requests') IS NOT NULL THEN
    ALTER TABLE public.withdraw_requests ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.ervenow_withdraw_requests') IS NOT NULL THEN
    ALTER TABLE public.ervenow_withdraw_requests ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "ervenow_ledger_wallets_service" ON public.ervenow_ledger_wallets;
CREATE POLICY "ervenow_ledger_wallets_service" ON public.ervenow_ledger_wallets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ervenow_ledger_tx_service" ON public.ervenow_ledger_transactions;
CREATE POLICY "ervenow_ledger_tx_service" ON public.ervenow_ledger_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "settlement_log_service" ON public.settlement_log;
CREATE POLICY "settlement_log_service" ON public.settlement_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF to_regclass('public.withdraw_requests') IS NOT NULL THEN
    DROP POLICY IF EXISTS "withdraw_requests_service" ON public.withdraw_requests;
    CREATE POLICY "withdraw_requests_service" ON public.withdraw_requests
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.ervenow_ledger_wallets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ervenow_ledger_transactions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.settlement_log TO authenticated, service_role;
DO $$ BEGIN
  IF to_regclass('public.withdraw_requests') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON public.withdraw_requests TO authenticated, service_role;
  END IF;
  IF to_regclass('public.ervenow_withdraw_requests') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON public.ervenow_withdraw_requests TO authenticated, service_role;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_map_user_role(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_ensure_wallet(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_append_completed(uuid, text, text, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_wallet_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_settle_delivered_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settlement_log_try_claim(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_credit(uuid, numeric, text, text, text) TO authenticated, service_role;
DO $$ BEGIN
  IF to_regprocedure('public.ervenow_ledger_finance_summary()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.ervenow_ledger_finance_summary() TO authenticated, service_role;
  END IF;
  IF to_regprocedure('public.ervenow_ledger_user_wallet_summary(uuid, text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.ervenow_ledger_user_wallet_summary(uuid, text) TO authenticated, service_role;
  END IF;
  IF to_regprocedure('public.ledger_withdraw_request_approve(uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.ledger_withdraw_request_approve(uuid) TO authenticated, service_role;
  END IF;
END $$;
