-- فهارس أداء شائعة لجدول الطلبات (راجع خطط الاستعلام الفعلية قبل الإنتاج)

CREATE INDEX IF NOT EXISTS idx_orders_store_id_created ON public.orders (store_id, created_at DESC)
WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_status_created ON public.orders (delivery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_driver_id_created ON public.orders (driver_id, created_at DESC)
WHERE driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON public.orders (customer_id, created_at DESC);
