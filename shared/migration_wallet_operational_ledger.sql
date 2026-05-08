-- =============================================================================
-- محفظة التشغيل: منع تكرار إيراد الطلب + رصيد مشتق من جدول الحركات (ervenow_wallet_transactions)
-- نفّذ بعد migration_ervenow_wallet_atomic_v2.sql (وجود الجدول والـ RPC الأساسيين).
-- =============================================================================

-- منع تسجيل أكثر من حركة earning لنفس الطلب (reference_id = order id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ervenow_wallet_tx_earning_per_order
  ON public.ervenow_wallet_transactions (reference_id)
  WHERE type = 'earning' AND reference_id IS NOT NULL AND status = 'completed';

-- ملخص الرصيد من الحركات المكتملة فقط (لا يعتمد على أعمدة balance المحلية وحدها)
CREATE OR REPLACE FUNCTION public.ervenow_wallet_operational_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'balance',
      round(coalesce(
        sum(
          CASE
            WHEN type = 'earning' AND status = 'completed' THEN amount
            WHEN type = 'withdraw' AND status = 'completed' THEN -amount
            ELSE 0
          END
        ), 0
      )::numeric, 2),
    'total_earned',
      round(coalesce(
        sum(CASE WHEN type = 'earning' AND status = 'completed' THEN amount ELSE 0 END), 0
      )::numeric, 2),
    'total_withdrawn',
      round(coalesce(
        sum(CASE WHEN type = 'withdraw' AND status = 'completed' THEN amount ELSE 0 END), 0
      )::numeric, 2)
  )
  FROM public.ervenow_wallet_transactions
  WHERE user_id = p_user_id;
$$;

COMMENT ON FUNCTION public.ervenow_wallet_operational_summary(uuid) IS
  'رصيد وإجماليات من sum(amount) على ervenow_wallet_transactions — completed فقط';

GRANT EXECUTE ON FUNCTION public.ervenow_wallet_operational_summary(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
