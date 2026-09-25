-- ERVENOW — إغلاق الثغرات الحرجة
-- لا يمس search_path ولا جداول food/delivery/legacy ولا الفهارس.
-- السيرفر يستخدم service_role فيتجاوز RLS ويحتفظ بتنفيذ الدوال.

-- 1) سحب تنفيذ الدوال المالية عن الزوار والمسجلين.
-- PUBLIC يورث التنفيذ لـ anon، لذلك يُسحب منه أيضاً ثم يُعاد لـ service_role فقط.
REVOKE ALL ON FUNCTION public.ledger_withdraw_request_approve(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_withdraw_request_approve(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.store_wallet_approve_withdrawal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_approve_withdrawal(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.store_wallet_credit_for_order(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_credit_for_order(uuid, uuid, numeric, text) TO service_role;

REVOKE ALL ON FUNCTION public.ervenow_redeem_topup_code(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ervenow_redeem_topup_code(uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.settlement_log_try_claim(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_log_try_claim(uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.generate_order_number(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_order_number(text) TO service_role;

-- 2) إغلاق orders و users عن الوصول المباشر.
-- لا تُستبدل السياسات بـ USING(true). service_role يتجاوز RLS.
DROP POLICY IF EXISTS "Allow all" ON public.orders;
DROP POLICY IF EXISTS "allow insert" ON public.users;
DROP POLICY IF EXISTS "allow select" ON public.users;

REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

-- 3) دلو خاص للوثائق فقط. الشعارات والبنرات وصور المنتجات تبقى في الدلو العام.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'store-registration-documents',
  'store-registration-documents',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
