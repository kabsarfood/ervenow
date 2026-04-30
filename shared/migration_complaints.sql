CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  user_id uuid,
  message text,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS complaints_status_idx ON public.complaints (status);
CREATE INDEX IF NOT EXISTS complaints_created_idx ON public.complaints (created_at);
