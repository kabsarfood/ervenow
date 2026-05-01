CREATE TABLE IF NOT EXISTS public.employee_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  city text,
  role_wanted text,
  note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_applications_status_idx
ON public.employee_applications (status);

CREATE INDEX IF NOT EXISTS employee_applications_created_idx
ON public.employee_applications (created_at DESC);
