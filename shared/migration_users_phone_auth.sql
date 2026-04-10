-- ERWENOW: دعم تسجيل الدخول بـ OTP واتساب (Twilio) بدون Supabase Auth
-- نفّذ مرة واحدة في SQL Editor إذا كان جدول users مرتبطاً بـ auth.users

-- 1) إزالة الربط بـ auth.users (إن وُجد)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- 2) معرّف تلقائي لكل صف جديد
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3) منع تكرار أرقام الجوال (مهم للـ upsert المنطقي من التطبيق)
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON public.users (phone)
  WHERE phone IS NOT NULL AND phone <> '';

-- ملاحظة: إن وُجدت صفوف بدون phone، عالجها يدوياً قبل إنشاء الفهرس الفريد.
