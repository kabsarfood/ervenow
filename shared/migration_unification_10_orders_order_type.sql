-- ERVENOW System Unification — order_type على orders (مرحلة 3)
-- نفّذ بعد migration_orders_unify_delivery.sql
-- الهدف: orders.type = delivery | store | service | food ...

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_type text;

COMMENT ON COLUMN public.orders.order_type IS
  'نوع الطلب الموحّد: delivery, store, restaurant, service, gas_delivery, … — يحل محل التفرّع الضمني لاحقاً';

CREATE INDEX IF NOT EXISTS orders_order_type_idx ON public.orders (order_type);

-- backfill تقريبي من store_id / service_provider_id (يدوي إن لزم)
UPDATE public.orders SET order_type = 'store' WHERE order_type IS NULL AND store_id IS NOT NULL;
UPDATE public.orders SET order_type = 'delivery' WHERE order_type IS NULL;
