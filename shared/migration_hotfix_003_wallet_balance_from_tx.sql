-- HOTFIX-003: الرصيد من مجموع الحركات المكتملة (يتطابق مع واجهة المحفظة والدفع)
-- يصلح حالة: رصيد ظاهر للعضو لكن ERVENOW PAY يرفض لعدم تطابق عمود balance

CREATE OR REPLACE FUNCTION public.ervenow_ledger_wallet_balance(p_wallet_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(coalesce(sum(
    CASE
      WHEN t.status = 'completed' AND t.direction = 'credit' THEN t.amount
      WHEN t.status = 'completed' AND t.direction = 'debit' THEN -t.amount
      ELSE 0::numeric
    END
  ), 0)::numeric, 2)
  FROM public.ervenow_ledger_transactions t
  WHERE t.wallet_id = p_wallet_id;
$$;

-- مزامنة عمود balance للتقارير والفهارس (لا يُستخدم كمصدر حقيقة بعد هذا الإصلاح)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.ervenow_ledger_wallets LOOP
    PERFORM public.ervenow_ledger_recalc_balance(r.id);
  END LOOP;
END $$;

-- محفظة المنصة (ضمان ERVENOW PAY)
INSERT INTO public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
SELECT NULL, 'platform', true, 0, 'SAR'
WHERE NOT EXISTS (SELECT 1 FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true);

GRANT EXECUTE ON FUNCTION public.ervenow_ledger_wallet_balance(uuid) TO authenticated, service_role;
