-- Production hardening: idempotency, checkout replay ledger, DLQ relies on Redis/BullMQ only (no DB).

-- Standalone delivery creates rows in public.orders — one order per (customer, key)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_customer_idempotency
  ON public.orders (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Legacy table (still present in some deployments)
ALTER TABLE public.delivery_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_idem
  ON public.delivery_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Full checkout JSON response replay (orders + mixed results array)
CREATE TABLE IF NOT EXISTS public.checkout_idempotency (
  customer_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_checkout_idempotency_created ON public.checkout_idempotency (created_at DESC);

-- Composite for store dashboards / filtering by store + status
CREATE INDEX IF NOT EXISTS idx_orders_store_status ON public.orders (store_id, status)
WHERE store_id IS NOT NULL;
