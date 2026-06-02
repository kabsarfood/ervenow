CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type text NOT NULL
    CHECK (recipient_type IN ('customer', 'driver', 'store', 'provider', 'admin')),
  recipient_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'system'
    CHECK (type IN ('order', 'wallet', 'payment', 'account', 'delivery', 'system', 'promotion')),
  source text NOT NULL DEFAULT 'ervenow'
    CHECK (source IN ('ervenow', 'wallet', 'delivery', 'store', 'admin')),
  is_read boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
ON public.notifications(recipient_type, recipient_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created
ON public.notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
ON public.notifications(is_read);
