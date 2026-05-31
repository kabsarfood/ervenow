-- عمود الاسم اختياري — يمنع أخطاء "column users.name does not exist"
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name text;

COMMENT ON COLUMN public.users.name IS 'اسم العرض (اختياري) — لوحة الإدارة تعمل بدونه';
