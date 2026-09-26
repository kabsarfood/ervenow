-- حضور المزوّد منفصل عن الإحداثيات. إعادة التشغيل آمنة.
-- لا يغيّر lat/lng ولا ينشئ محفظة.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN public.users.last_seen_at IS
  'آخر حضور للبوابة وهي ظاهرة. لا يعني أن الإحداثيات تغيّرت.';
