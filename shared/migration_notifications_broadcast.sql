-- Notification Center 2.1 — add broadcast type
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'order', 'wallet', 'payment', 'account', 'delivery',
    'system', 'promotion', 'broadcast'
  ));
