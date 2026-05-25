-- =============================================================================
-- ERVENOW Database Refactor — Phase 3: Link drivers ↔ users
-- Backward compatible: drivers.id unchanged; adds optional user_id FK
-- =============================================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE public.drivers d
SET user_id = u.id
FROM public.users u
WHERE d.user_id IS NULL
  AND d.phone IS NOT NULL
  AND trim(d.phone) <> ''
  AND u.phone IS NOT NULL
  AND regexp_replace(u.phone, '\D', '', 'g') = regexp_replace(d.phone, '\D', '', 'g');

COMMENT ON COLUMN public.drivers.user_id IS
  'FK to users.id — same person as driver profile; match via normalized phone when null';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_drivers_user'
      AND conrelid = 'public.drivers'::regclass
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT fk_drivers_user
      FOREIGN KEY (user_id) REFERENCES public.users (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drivers_user_id
  ON public.drivers (user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_user_id
  ON public.drivers (user_id)
  WHERE user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
