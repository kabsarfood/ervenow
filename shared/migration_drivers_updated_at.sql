-- إصلاح: Could not find the 'updated_at' column of 'drivers' in the schema cache
-- نفّذ في Supabase → SQL Editor (مرة واحدة).

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.drivers.updated_at IS 'آخر تحديث لسجل المندوب';
