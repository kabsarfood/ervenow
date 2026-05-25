-- =============================================================================
-- ERVENOW Database Refactor — Phase 5: Idempotent settlement tracking
-- Prevents duplicate settlement side-effects across parallel financial paths
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.settlement_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('order', 'service_booking', 'withdraw_request', 'other')),
  settlement_kind text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT settlement_log_entity_kind_unique UNIQUE (entity_id, entity_type, settlement_kind)
);

CREATE INDEX IF NOT EXISTS idx_settlement_log_entity
  ON public.settlement_log (entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_settlement_log_processed_at
  ON public.settlement_log (processed_at DESC);

COMMENT ON TABLE public.settlement_log IS
  'Idempotency log for delivered/completed financial hooks (ledger, COD, operational, legacy finance)';

COMMENT ON COLUMN public.settlement_log.settlement_kind IS
  'e.g. ledger_delivered, driver_cod_commission, operational_earning, finance_wallets_settle';

-- Claim settlement slot (returns true if this caller should proceed)
CREATE OR REPLACE FUNCTION public.settlement_log_try_claim(
  p_entity_id uuid,
  p_entity_type text,
  p_settlement_kind text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_id IS NULL OR coalesce(trim(p_entity_type), '') = '' OR coalesce(trim(p_settlement_kind), '') = '' THEN
    RETURN false;
  END IF;
  INSERT INTO public.settlement_log (entity_id, entity_type, settlement_kind, metadata)
  VALUES (p_entity_id, p_entity_type, p_settlement_kind, coalesce(p_metadata, '{}'::jsonb));
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settlement_log_try_claim(uuid, text, text, jsonb)
  TO authenticated, service_role;

ALTER TABLE public.settlement_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement_log_service" ON public.settlement_log;
CREATE POLICY "settlement_log_service" ON public.settlement_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
