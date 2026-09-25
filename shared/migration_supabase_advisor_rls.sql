-- يغلق تحذيرات Security Advisor بعد ترقية Pro:
--   public.order_number_counters  RLS Disabled
--   public.stores                  RLS Disabled
--   public.withdraw_requests       Security Definer View
-- الخادم يستخدم service_role فيتجاوز RLS. anon و authenticated يُرفضان.

DO $$
BEGIN
  IF to_regclass('public.order_number_counters') IS NOT NULL THEN
    ALTER TABLE public.order_number_counters ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.order_number_counters FROM anon, authenticated;
    GRANT ALL ON TABLE public.order_number_counters TO service_role;
  END IF;
END $$;

DROP POLICY IF EXISTS "order_number_counters_deny_anon" ON public.order_number_counters;
DROP POLICY IF EXISTS "order_number_counters_deny_authenticated" ON public.order_number_counters;

DO $$
BEGIN
  IF to_regclass('public.order_number_counters') IS NULL THEN
    RETURN;
  END IF;
  CREATE POLICY "order_number_counters_deny_anon"
    ON public.order_number_counters
    FOR ALL TO anon
    USING (false) WITH CHECK (false);
  CREATE POLICY "order_number_counters_deny_authenticated"
    ON public.order_number_counters
    FOR ALL TO authenticated
    USING (false) WITH CHECK (false);
END $$;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stores TO service_role;

DROP POLICY IF EXISTS "stores_deny_anon" ON public.stores;
CREATE POLICY "stores_deny_anon"
  ON public.stores
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "stores_deny_authenticated" ON public.stores;
CREATE POLICY "stores_deny_authenticated"
  ON public.stores
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER VIEW public.withdraw_requests SET (security_invoker = true);
REVOKE ALL ON TABLE public.withdraw_requests FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.withdraw_requests TO service_role;
