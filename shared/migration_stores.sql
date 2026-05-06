-- =============================================================================
-- تسجيل طلبات المتاجر (مراجعة يدوية + واتساب للإدارة)
-- نفّذ في Supabase → SQL Editor
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  commercial_register text,
  file_url text,
  lat double precision,
  lng double precision,
  type text NOT NULL CHECK (
    type IN (
      'restaurant',
      'pharmacy',
      'supermarket',
      'minimarket',
      'vegetables',
      'butcher',
      'fish',
      'home_business',
      'services',
      'other'
    )
  ),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stores_status_idx ON public.stores (status);
CREATE INDEX IF NOT EXISTS stores_created_at_idx ON public.stores (created_at DESC);
CREATE INDEX IF NOT EXISTS stores_type_idx ON public.stores (type);

COMMENT ON TABLE public.stores IS 'طلبات تسجيل متاجر — الموافقة لاحقاً من الإدارة';

-- تخزين مرفقات السجل (اختياري): أنشئ دلواً في Storage (مثلاً: erwenow-store-registrations) واضبط السياسات.
