-- توسيع حالات delivery_status: مسودة قبل الدفع + picked اختياري بين accepted و delivering
-- نفّذ في Supabase SQL Editor بعد migration_orders_unify_delivery.sql

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_delivery_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_status_check
  CHECK (
    LOWER(COALESCE(delivery_status, '')) IN (
      'draft',
      'new',
      'pending',
      'accepted',
      'picked',
      'delivering',
      'delivered',
      'cancelled',
      'cancelled_by_customer'
    )
  );

COMMENT ON CONSTRAINT orders_delivery_status_check ON public.orders IS
  'draft = لم يُنشر للمناديب؛ pending/new مفتوح؛ picked بين accepted و delivering (اختياري)';
