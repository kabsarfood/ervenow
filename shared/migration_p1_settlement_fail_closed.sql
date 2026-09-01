-- P1-03 — إطلاق claim التسوية عند فشل RPC حتى يمكن إعادة المحاولة دون تسوية مزدوجة.
-- نفّذ بعد migration_database_refactor_05_settlement_log.sql

CREATE OR REPLACE FUNCTION public.settlement_log_release_claim(
  p_entity_id uuid,
  p_entity_type text,
  p_settlement_kind text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  IF p_entity_id IS NULL OR coalesce(trim(p_entity_type), '') = '' OR coalesce(trim(p_settlement_kind), '') = '' THEN
    RETURN false;
  END IF;
  DELETE FROM public.settlement_log
  WHERE entity_id = p_entity_id
    AND entity_type = p_entity_type
    AND settlement_kind = p_settlement_kind
    AND coalesce(metadata->>'settled', '') IS DISTINCT FROM 'true';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.settlement_log_release_claim(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_log_release_claim(uuid, text, text) TO service_role;
