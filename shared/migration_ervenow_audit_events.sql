-- ERVENOW: سجل تدقيق append-only للعمليات الحساسة
-- نفّذ في Supabase SQL Editor قبل استخدام shared/services/auditLog.js

CREATE TABLE IF NOT EXISTS public.ervenow_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  action text NOT NULL,
  actor_type text,
  actor_id uuid,
  subject_type text,
  subject_id text,
  ip text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_before jsonb,
  payload_after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ervenow_audit_created
  ON public.ervenow_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ervenow_audit_scope_action
  ON public.ervenow_audit_events (scope, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ervenow_audit_actor
  ON public.ervenow_audit_events (actor_type, actor_id, created_at DESC);

COMMENT ON TABLE public.ervenow_audit_events IS 'Audit log — إدراج من الخادم فقط (service role)';

ALTER TABLE public.ervenow_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ervenow_audit_no_direct_access" ON public.ervenow_audit_events;
CREATE POLICY "ervenow_audit_no_direct_access"
  ON public.ervenow_audit_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
