-- =============================================================================
-- ERVENOW — توحيد نهائي لطلبات السحب (ledger_only)
-- =============================================================================
-- نفّذ مرة واحدة في Supabase → SQL Editor (بالكامل).
--
-- النتيجة:
--   • جدول فعلي واحد: ervenow_withdraw_requests (+ processed_at على الجدول للموافقة)
--   • VIEW توافق: withdraw_requests (6 أعمدة — بدون processed_at)
--   • لا يُنشأ جدول withdraw_requests
--
-- يُفضَّل أن تكون هجرة ledger منفّذة مسبقاً:
--   shared/migration_bootstrap_ledger_finance.sql
-- (لـ ledger_withdraw_request_approve وخصم الرصيد)
-- =============================================================================

-- ─── 1) الجدول الأساسي (canonical) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ervenow_withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  iban text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.ervenow_withdraw_requests
  ADD COLUMN IF NOT EXISTS iban text;

ALTER TABLE public.ervenow_withdraw_requests
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

ALTER TABLE public.ervenow_withdraw_requests
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.ervenow_withdraw_requests
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- تأكد من NOT NULL على الأعمدة الأساسية (للجداول القديمة الناقصة)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ervenow_withdraw_requests'
      AND column_name = 'amount' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.ervenow_withdraw_requests
      ALTER COLUMN amount SET NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[withdraw_final] amount NOT NULL skip: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_ervenow_withdraw_user
  ON public.ervenow_withdraw_requests (user_id, status);

CREATE INDEX IF NOT EXISTS idx_ervenow_withdraw_created
  ON public.ervenow_withdraw_requests (created_at DESC);

COMMENT ON TABLE public.ervenow_withdraw_requests IS
  'CANONICAL — withdraw requests (ledger_only); debits via reference_id withdraw:{id}';

-- ─── 2) نقل بيانات من جدول withdraw_requests القديم (إن وُجد كـ TABLE) ─────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind = 'r'
  ) THEN
    INSERT INTO public.ervenow_withdraw_requests (
      id, user_id, amount, iban, status, note, created_at, processed_at
    )
    SELECT
      wr.id,
      wr.user_id,
      wr.amount,
      NULL::text,
      CASE
        WHEN wr.status IN ('approved', 'paid') THEN 'approved'
        WHEN wr.status = 'rejected' THEN 'rejected'
        ELSE coalesce(wr.status, 'pending')
      END,
      wr.note,
      coalesce(wr.created_at, now()),
      wr.processed_at
    FROM public.withdraw_requests wr
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE public.withdraw_requests RENAME TO withdraw_requests_ledger_archive;

    COMMENT ON TABLE public.withdraw_requests_ledger_archive IS
      'ARCHIVE — legacy TABLE withdraw_requests; merged into ervenow_withdraw_requests';
  END IF;
END $$;

-- ─── 3) إزالة VIEW قديم خاطئ ثم إنشاء VIEW متوافق (6 أعمدة فقط) ───────────
DROP VIEW IF EXISTS public.withdraw_requests CASCADE;

CREATE OR REPLACE VIEW public.withdraw_requests AS
SELECT
  id,
  user_id,
  amount,
  CASE WHEN status = 'paid' THEN 'approved'::text ELSE status END AS status,
  created_at,
  note
FROM public.ervenow_withdraw_requests;

COMMENT ON VIEW public.withdraw_requests IS
  'COMPAT VIEW → ervenow_withdraw_requests (قراءة/إدراج عبر trigger). لا processed_at في الواجهة.';

-- ─── 4) INSERT عبر VIEW → الجدول الأساسي ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.withdraw_requests_view_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ervenow_withdraw_requests (
    id, user_id, amount, iban, status, note, created_at
  )
  VALUES (
    coalesce(NEW.id, gen_random_uuid()),
    NEW.user_id,
    NEW.amount,
    NULL,
    coalesce(NEW.status, 'pending'),
    NEW.note,
    coalesce(NEW.created_at, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdraw_requests_view_insert ON public.withdraw_requests;

CREATE TRIGGER trg_withdraw_requests_view_insert
  INSTEAD OF INSERT ON public.withdraw_requests
  FOR EACH ROW EXECUTE FUNCTION public.withdraw_requests_view_insert();

-- ─── 5) موافقة أدمن + خصم ledger (إن وُجدت دوال الدفتر) ───────────────────
DO $$
BEGIN
  IF to_regclass('public.ervenow_ledger_wallets') IS NULL THEN
    RAISE NOTICE '[withdraw_final] ervenow_ledger_* missing — skip ledger_withdraw_request_approve (run bootstrap)';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.ledger_withdraw_request_approve(p_request_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      r record;
      urole text;
      wid uuid;
      amt numeric(14, 2);
      bal numeric(14, 2);
      ref text;
    BEGIN
      SELECT * INTO r FROM public.ervenow_withdraw_requests WHERE id = p_request_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
      END IF;

      IF r.status IN ('approved', 'paid') THEN
        RETURN jsonb_build_object('ok', true, 'reason', 'already_approved');
      END IF;

      IF r.status <> 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', r.status);
      END IF;

      amt := round(coalesce(r.amount, 0)::numeric, 2);
      IF amt <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
      END IF;

      SELECT role INTO urole FROM public.users WHERE id = r.user_id LIMIT 1;
      wid := public.ervenow_ledger_ensure_wallet(r.user_id, coalesce(urole, 'driver'));
      bal := public.ervenow_ledger_wallet_balance(wid);

      IF bal < amt THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal, 'amount', amt);
      END IF;

      ref := 'withdraw:' || p_request_id::text;

      IF EXISTS (
        SELECT 1 FROM public.ervenow_ledger_transactions t
        WHERE t.wallet_id = wid AND t.reference_id = ref AND t.status = 'completed'
      ) THEN
        UPDATE public.ervenow_withdraw_requests
        SET status = 'approved', processed_at = now()
        WHERE id = p_request_id;
        RETURN jsonb_build_object('ok', true, 'reason', 'already_processed');
      END IF;

      INSERT INTO public.ervenow_ledger_transactions (
        wallet_id, type, direction, amount, status, reference_id, description
      )
      VALUES (wid, 'withdraw', 'debit', amt, 'completed', ref, 'سحب — موافقة إدارية');

      UPDATE public.ervenow_withdraw_requests
      SET status = 'approved', processed_at = now()
      WHERE id = p_request_id;

      RETURN jsonb_build_object('ok', true, 'reason', 'approved', 'amount', amt, 'balance_after', bal - amt);
    EXCEPTION
      WHEN unique_violation THEN
        UPDATE public.ervenow_withdraw_requests
        SET status = 'approved', processed_at = coalesce(processed_at, now())
        WHERE id = p_request_id AND status = 'pending';
        RETURN jsonb_build_object('ok', true, 'reason', 'already_processed');
    END;
    $body$;
  $fn$;
END $$;

-- ─── 6) RLS + صلاحيات ───────────────────────────────────────────────────────
ALTER TABLE public.ervenow_withdraw_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ervenow_withdraw_service" ON public.ervenow_withdraw_requests;
CREATE POLICY "ervenow_withdraw_service" ON public.ervenow_withdraw_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.ervenow_withdraw_requests TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ledger_withdraw_request_approve'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.ledger_withdraw_request_approve(uuid) TO authenticated, service_role;
  END IF;
END $$;

-- ─── 7) PostgREST ───────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── 8) تحقق ────────────────────────────────────────────────────────────────
SELECT
  CASE c.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'v' THEN 'VIEW'
    ELSE c.relkind::text
  END AS withdraw_requests_kind,
  (SELECT count(*) FROM public.ervenow_withdraw_requests) AS ervenow_rows,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ledger_withdraw_request_approve'
  ) AS approve_rpc_ok
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests';

SELECT id, user_id, amount, status, created_at, note
FROM public.withdraw_requests
LIMIT 5;
