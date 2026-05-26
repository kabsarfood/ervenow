-- =============================================================================
-- ERVENOW — orders.provider_id (SoT لمزود الخدمة)
-- يصلح: Could not find the 'provider_id' column of 'orders' in the schema cache
-- service_provider_id اختياري للتوافق — يُزامَن من provider_id
-- نفّذ في Supabase → SQL Editor ثم أعد تحميل schema (NOTIFY أدناه).
-- =============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_provider_id uuid REFERENCES public.users(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.orders.service_provider_id IS 'مزود الخدمة (users.id) — موازٍ لـ provider_id';
COMMENT ON COLUMN public.orders.provider_id IS 'مزود الخدمة — يُزامَن مع service_provider_id';

CREATE INDEX IF NOT EXISTS idx_orders_service_provider ON public.orders (service_provider_id)
  WHERE service_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_provider_id ON public.orders (provider_id)
  WHERE provider_id IS NOT NULL;

-- مزامنة من الأعمدة الموجودة
UPDATE public.orders
SET service_provider_id = provider_id
WHERE service_provider_id IS NULL AND provider_id IS NOT NULL;

UPDATE public.orders
SET provider_id = service_provider_id
WHERE provider_id IS NULL AND service_provider_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
