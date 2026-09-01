-- P0-05 — إغلاق RLS المالي: لا USING (true) لبيانات المحفظة/الدفتر
-- المعمارية: Node يستخدم service_role فيتجاوز RLS. هذه السياسات تمنع PostgREST
-- (anon / authenticated) من قراءة أو تعديل أموال الغير إذا تسرّب المفتاح العام.
--
-- نفّذ في Supabase SQL Editor بعد مراجعة الفريق.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ervenow_ledger_wallets',
    'ervenow_ledger_transactions',
    'settlement_log',
    'withdraw_requests',
    'ervenow_withdraw_requests',
    'wallets',
    'wallet_transactions',
    'withdrawals',
    'refunds',
    'commission_rules',
    'ervenow_wallets',
    'ervenow_wallet_transactions',
    'driver_wallets',
    'driver_ledger',
    'store_wallets',
    'store_transactions',
    'wallet_topup_requests',
    'wallet_topup_codes',
    'debt_payment_sessions',
    'provider_commission_debts'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    -- جداول فقط — لا views / materialized
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
      END LOOP;

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)',
        t || '_p0_deny_anon', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)',
        t || '_p0_deny_authenticated', t
      );

      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'P0-05 skip %: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- RPCs مالية: التنفيذ للخادم فقط
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'ervenow_ledger%'
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', fn.proname, fn.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', fn.proname, fn.args);
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END LOOP;
END $$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.ervenow_wallet_customer_refund_atomic(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.ervenow_wallet_customer_refund_atomic(uuid, uuid, numeric) TO service_role;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

-- P0-05 applied: finance tables deny anon/authenticated; service_role remains backend-only.
