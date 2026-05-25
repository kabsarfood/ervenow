-- =============================================================================
-- ERVENOW — Feature Control للنظام المالي (قابل للتوسع)
-- mode: 0 = OFF | 1 = ON (manual) | 2 = AUTO
-- نفّذ في Supabase SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_feature_flags (
  key TEXT PRIMARY KEY,
  mode INTEGER NOT NULL DEFAULT 0 CHECK (mode IN (0, 1, 2)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_feature_flags IS 'تحكم بميزات المنصة — 0 OFF, 1 ON, 2 AUTO';
COMMENT ON COLUMN public.platform_feature_flags.mode IS '0=OFF, 1=ON (manual), 2=AUTO';

INSERT INTO public.platform_feature_flags (key, mode)
VALUES
  ('auto_freeze', 2),
  ('auto_payout', 2),
  ('financial_alerts', 2),
  ('finance_charts', 2),
  ('withdraw_system', 1)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.platform_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_feature_flags_service" ON public.platform_feature_flags;
CREATE POLICY "platform_feature_flags_service" ON public.platform_feature_flags
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_feature_flags TO service_role;
GRANT SELECT ON public.platform_feature_flags TO authenticated;

NOTIFY pgrst, 'reload schema';
