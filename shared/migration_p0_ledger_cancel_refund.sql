-- P0-03 — استرداد إلغاء طلب EW PAY على دفتر ervenow_ledger_* فقط
-- نفّذ بعد migration_ervenow_pay_checkout.sql
-- لا يكتب على ervenow_wallets

CREATE OR REPLACE FUNCTION public.ervenow_ledger_refund_cancelled_order(
  p_order_id uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay_ref text;
  refund_ref text;
  escrow_ref text;
  escrow_refund_ref text;
  hold_ref text;
  pay_amt numeric(14, 2);
  wid_cust uuid;
  wid_platform uuid;
  wid_merchant uuid;
  o_merchant uuid;
  credit_res jsonb;
  escrow_res jsonb;
BEGIN
  IF p_order_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_ids');
  END IF;

  -- Serialize concurrent refunds for the same order (unique index is the second line of defense)
  PERFORM pg_advisory_xact_lock(hashtext('ervenow_refund:' || p_order_id::text));

  IF to_regclass('public.settlement_log') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.settlement_log s
      WHERE s.entity_id = p_order_id
        AND s.entity_type = 'order'
        AND s.settlement_kind = 'ledger_delivered'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_settled');
    END IF;
  END IF;

  pay_ref := 'pay:order:' || p_order_id::text;
  refund_ref := 'refund:order:' || p_order_id::text;
  escrow_ref := 'escrow:order:' || p_order_id::text;
  escrow_refund_ref := 'refund-escrow:order:' || p_order_id::text;
  hold_ref := 'order:' || p_order_id::text || ':hold:merchant';

  SELECT t.amount, t.wallet_id INTO pay_amt, wid_cust
  FROM public.ervenow_ledger_transactions t
  JOIN public.ervenow_ledger_wallets w ON w.id = t.wallet_id
  WHERE t.reference_id = pay_ref
    AND t.type = 'payment'
    AND t.direction = 'debit'
    AND t.status = 'completed'
    AND w.user_id = p_customer_id
    AND w.role = 'customer'
  LIMIT 1;

  IF pay_amt IS NULL OR pay_amt <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'not_ew_pay', 'refunded', false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ervenow_ledger_transactions t
    WHERE t.wallet_id = wid_cust
      AND t.reference_id = refund_ref
      AND t.status = 'completed'
      AND t.direction = 'credit'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_refunded', 'amount', pay_amt, 'refunded', false);
  END IF;

  credit_res := public.ervenow_ledger_append_completed(
    wid_cust, 'refund', 'credit', pay_amt, refund_ref, 'استرداد إلغاء طلب — ERVENOW PAY'
  );
  IF coalesce(credit_res->>'reason', '') = 'duplicate' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_refunded', 'amount', pay_amt, 'refunded', false);
  END IF;

  SELECT w.id INTO wid_platform FROM public.ervenow_ledger_wallets w WHERE w.is_platform = true LIMIT 1;
  IF wid_platform IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.ervenow_ledger_transactions t
      WHERE t.wallet_id = wid_platform
        AND t.reference_id = escrow_ref
        AND t.status = 'completed'
        AND t.direction = 'credit'
    ) THEN
      escrow_res := public.ervenow_ledger_append_completed(
        wid_platform, 'refund', 'debit', pay_amt, escrow_refund_ref, 'عكس ضمان ERVENOW PAY — إلغاء طلب'
      );
    END IF;
  END IF;

  UPDATE public.ervenow_ledger_transactions t
  SET status = 'failed'
  WHERE t.reference_id = hold_ref
    AND t.status = 'pending';

  SELECT merchant_id INTO o_merchant FROM public.orders WHERE id = p_order_id LIMIT 1;
  IF o_merchant IS NOT NULL THEN
    wid_merchant := public.ervenow_ledger_ensure_wallet(o_merchant, 'merchant');
    UPDATE public.ervenow_ledger_transactions t
    SET status = 'failed'
    WHERE t.wallet_id = wid_merchant
      AND t.reference_id = hold_ref
      AND t.status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'refunded',
    'amount', pay_amt,
    'refunded', true,
    'escrow', escrow_res
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ervenow_ledger_refund_cancelled_order(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ervenow_ledger_refund_cancelled_order(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ervenow_ledger_refund_cancelled_order(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.ervenow_ledger_refund_cancelled_order(uuid, uuid) IS
  'P0: reverse EW PAY checkout on cancel — customer ledger credit, escrow debit, void merchant hold. Idempotent via refund:order:{id}.';
