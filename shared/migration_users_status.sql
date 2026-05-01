ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

UPDATE public.users
SET status = 'blocked'
WHERE role = 'blocked';

UPDATE public.users
SET role = 'user'
WHERE role = 'blocked';
