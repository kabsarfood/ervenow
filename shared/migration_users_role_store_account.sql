-- =============================================================================
-- ERVENOW Store Account — users.role فقط (لا Ledger ولا stores.type)
-- نفّذ يدوياً في Supabase SQL Editor بعد نجاح اختبارات المرحلة 6
-- =============================================================================

-- 1) توسيع قيد الدور (إن وُجد users_role_check)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'customer',
    'driver',
    'store',
    'merchant',
    'restaurant',
    'service',
    'admin',
    'user',
    'blocked'
  ));

COMMENT ON COLUMN public.users.role IS
  'Store Account: store (رسمي). merchant/restaurant legacy — يُزال لاحقاً.';

-- 2) تحويل حسابات الشريك الحالية (مثال: كبسار — متجر واحد)
UPDATE public.users
SET role = 'store', updated_at = now()
WHERE lower(trim(role)) IN ('merchant', 'restaurant');

-- 3) تحقق
-- SELECT id, phone, role, status FROM public.users WHERE role IN ('store','merchant','restaurant');
