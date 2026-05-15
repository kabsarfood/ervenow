-- توصيل الغاز: نوع الخدمة + مديونيات عمولة المزودين
ALTER TABLE public.service_bookings
ADD COLUMN IF NOT EXISTS gas_mode text,
ADD COLUMN IF NOT EXISTS gas_liters integer,
ADD COLUMN IF NOT EXISTS commission_settled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS commission_due boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS commission_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS service_bookings_gas_mode_idx ON public.service_bookings (gas_mode);

CREATE TABLE IF NOT EXISTS public.provider_commission_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  service_order_number text,
  service_type text,
  service_name text,
  customer_phone text,
  total_amount numeric DEFAULT 0,
  commission_amount numeric DEFAULT 0,
  commission_rate numeric DEFAULT 0.07,
  status text DEFAULT 'pending',
  collected_at timestamptz,
  collected_note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_commission_debts_status_idx ON public.provider_commission_debts (status);
CREATE INDEX IF NOT EXISTS provider_commission_debts_provider_idx ON public.provider_commission_debts (provider_id);
CREATE INDEX IF NOT EXISTS provider_commission_debts_created_idx ON public.provider_commission_debts (created_at DESC);
