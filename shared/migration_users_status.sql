ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

COMMENT ON COLUMN public.users.status IS 'active=معتمد · pending=بانتظار الموافقة · rejected=مرفوض · blocked=محظور';

-- الحسابات الحالية تبقى active؛ التسجيل الجديد يُنشأ pending من الخادم
UPDATE public.users
SET status = 'blocked'
WHERE role = 'blocked';

UPDATE public.users
SET role = 'user'
WHERE role = 'blocked';

UPDATE public.users
SET status = 'active'
WHERE status IS NULL OR trim(status) = '';
