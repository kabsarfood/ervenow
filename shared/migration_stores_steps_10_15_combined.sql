-- =============================================================================
-- ERVENOW: الخطوات 10–15 (محفظة + إعدادات + أقسام)
-- نفّذ بعد الخطوات 1–9 (خصوصاً migration_store_wallet.sql)
-- =============================================================================

-- ── 10: store_wallet_credit_for_order ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.store_wallet_credit_for_order(
  p_store_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  IF p_store_id IS NULL OR p_order_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.store_wallets (store_id, balance)
  VALUES (p_store_id, 0)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.store_transactions (store_id, order_id, amount, type)
  VALUES (p_store_id, p_order_id, p_amount, 'credit')
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = row_count;

  IF v_inserted > 0 THEN
    UPDATE public.store_wallets
    SET balance = balance + p_amount
    WHERE store_id = p_store_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_wallet_credit_for_order(uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_wallet_credit_for_order(uuid, uuid, numeric, text) TO authenticated;

-- ── 11: سحوبات + offer_price + دالة الموافقة ────────────────────────────────
ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS offer_price numeric;
ALTER TABLE public.store_transactions ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS public.store_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_withdrawals_store_status_idx
  ON public.store_withdrawals (store_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.store_wallet_approve_withdrawal(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  bal numeric;
  v_inserted int;
BEGIN
  IF p_withdrawal_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_id');
  END IF;

  SELECT * INTO w FROM public.store_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF lower(w.status) <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  INSERT INTO public.store_wallets (store_id, balance)
  VALUES (w.store_id, 0)
  ON CONFLICT (store_id) DO NOTHING;

  SELECT balance INTO bal FROM public.store_wallets WHERE store_id = w.store_id FOR UPDATE;
  IF bal IS NULL THEN bal := 0; END IF;

  IF bal < w.amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal);
  END IF;

  UPDATE public.store_wallets SET balance = balance - w.amount WHERE store_id = w.store_id;

  INSERT INTO public.store_transactions (store_id, order_id, amount, type, description)
  VALUES (w.store_id, NULL, w.amount, 'debit', 'سحب أرباح #' || w.id::text);

  UPDATE public.store_withdrawals
  SET status = 'approved', updated_at = now()
  WHERE id = p_withdrawal_id AND status = 'pending';

  GET DIAGNOSTICS v_inserted = row_count;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'update_failed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'approved', 'amount', w.amount, 'store_id', w.store_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_wallet_approve_withdrawal(uuid) TO service_role;

-- ── 12: platform_settings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_settings_updated_idx ON public.platform_settings (updated_at DESC);

INSERT INTO public.platform_settings (key, value)
VALUES
  ('logo_url', ''),
  ('primary_color', '#5b371d'),
  ('secondary_color', '#8b5e34'),
  ('accent_color', '#d4a76a'),
  ('background_color', '#f8f5f0'),
  ('text_color', '#2b1f16')
ON CONFLICT (key) DO NOTHING;

-- ── 13: checkout_payment_methods ────────────────────────────────────────────
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES (
  'checkout_payment_methods',
  '{"ew_pay":true,"mada":true,"visa":true,"mastercard":true,"apple_pay":true,"stc_pay":true,"cash_on_delivery":true,"tabby":true,"tamara":true}',
  now()
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.store_merchant_hub
  ADD COLUMN IF NOT EXISTS checkout_payment_methods jsonb;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS checkout_payment_methods jsonb;

-- ── 14: categories (يحذف الجدول القديم إن وُجد) ───────────────────────────
DROP TABLE IF EXISTS public.categories CASCADE;

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('restaurant', 'market')),
  scope text NOT NULL CHECK (scope IN ('store', 'product')),
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  icon text,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_type_scope_active_sort
  ON public.categories (type, scope, is_active, sort_order);

INSERT INTO public.categories (type, scope, slug, name_ar, sort_order, is_active)
VALUES
  ('restaurant', 'store', 'kabsa_bukhari', 'مطاعم كبسة وبخاري', 10, true),
  ('restaurant', 'store', 'shawarma_grill', 'مطاعم شاورما ومشاوي', 20, true),
  ('restaurant', 'store', 'seafood', 'مطاعم سمك', 30, true),
  ('restaurant', 'store', 'burger', 'مطاعم برقر', 40, true),
  ('restaurant', 'store', 'broasted', 'مطاعم بروستد', 50, true),
  ('restaurant', 'store', 'pizza', 'مطاعم بيتزا', 60, true),
  ('restaurant', 'store', 'cafe', 'مقاهي', 70, true),
  ('restaurant', 'store', 'sweets', 'حلويات', 80, true),
  ('restaurant', 'store', 'home_producers', 'أسر منتجة', 90, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.categories (type, scope, slug, name_ar, sort_order, is_active)
VALUES
  ('market', 'product', 'vegetables', 'خضار وفواكه', 10, true),
  ('market', 'product', 'meat', 'لحوم', 20, true),
  ('market', 'product', 'dairy', 'ألبان', 30, true),
  ('market', 'product', 'cleaning', 'منظفات', 40, true),
  ('market', 'product', 'bakery', 'مخبوزات', 50, true),
  ('market', 'product', 'drinks', 'مشروبات', 60, true),
  ('market', 'product', 'snacks', 'سناكات', 70, true),
  ('market', 'product', 'frozen', 'مجمدات', 80, true)
ON CONFLICT (slug) DO NOTHING;

-- ── 15: category usage ──────────────────────────────────────────────────────
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_categories_type_scope_usage
  ON public.categories (type, scope, is_active, usage_count DESC);

NOTIFY pgrst, 'reload schema';
