-- سبب رفض طلب سحب المتجر (اختياري — يُعرض في بوابة التاجر)
ALTER TABLE public.store_withdrawals
  ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN public.store_withdrawals.rejection_reason IS 'سبب رفض الإدارة لطلب السحب — يظهر للتاجر';

NOTIFY pgrst, 'reload schema';
