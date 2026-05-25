-- =============================================================================
-- ERVENOW Database Refactor — Phase 6: Audit indexes (idempotent)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_created_at
  ON public.ervenow_audit_events (created_at DESC);

-- Equivalent to idx_ervenow_audit_created from migration_ervenow_audit_events.sql
COMMENT ON TABLE public.ervenow_audit_events IS
  'Audit log — append-only; server inserts via service role';

NOTIFY pgrst, 'reload schema';
