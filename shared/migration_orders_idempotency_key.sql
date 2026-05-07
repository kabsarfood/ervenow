-- عمود idempotency_key على orders (منع تكرار الطلب عند نفس المفتاح) + فهرس فريد
-- إن وُجدت بالفعل في migration_production_hardening.sql فهذا الملف idempotent (IF NOT EXISTS).

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_customer_idempotency
  ON public.orders (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
