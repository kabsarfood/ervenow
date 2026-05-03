-- ربط الطلبات بالمتاجر + زيادة عداد الطلبات عبر RPC

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_store_id ON public.orders (store_id);

CREATE OR REPLACE FUNCTION public.increment_store_orders(store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF store_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.stores
  SET total_orders = COALESCE(total_orders, 0) + 1
  WHERE id = store_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_store_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_store_orders(uuid) TO authenticated;
