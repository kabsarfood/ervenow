CREATE TABLE IF NOT EXISTS public.driver_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  driver_id uuid,
  phone text,
  channel text DEFAULT 'whatsapp',
  status text DEFAULT 'pending',
  error text,
  attempts int DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_notifications_order
ON public.driver_notifications (order_id);

CREATE INDEX IF NOT EXISTS idx_driver_notifications_status
ON public.driver_notifications (status);
