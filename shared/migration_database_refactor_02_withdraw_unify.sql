-- =============================================================================
-- ERVENOW Database Refactor — Phase 2: Unify withdraw on ervenow_withdraw_requests
-- Does NOT drop tables — renames legacy ledger-only table, exposes compatibility VIEW
-- Requires: migration_ervenow_withdraw_requests_schema_cache.sql (or payouts migration)
-- =============================================================================

-- ——— Canonical table comment ———
COMMENT ON TABLE public.ervenow_withdraw_requests IS
  'CANONICAL — withdraw requests; ledger debits use reference_id withdraw:{id}';

-- ——— Migrate rows from legacy TABLE withdraw_requests (ledger migration) if present ———
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'withdraw_requests'
      AND c.relkind = 'r'
  ) THEN
    INSERT INTO public.ervenow_withdraw_requests (
      id, user_id, amount, status, note, created_at, processed_at
    )
    SELECT
      wr.id,
      wr.user_id,
      wr.amount,
      CASE
        WHEN wr.status = 'approved' THEN 'approved'
        WHEN wr.status = 'rejected' THEN 'rejected'
        ELSE 'pending'
      END,
      wr.note,
      wr.created_at,
      wr.processed_at
    FROM public.withdraw_requests wr
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE public.withdraw_requests RENAME TO withdraw_requests_ledger_archive;

    COMMENT ON TABLE public.withdraw_requests_ledger_archive IS
      'ARCHIVE — former ledger withdraw_requests table; data copied to ervenow_withdraw_requests';
  END IF;
END $$;

-- ——— Compatibility VIEW (only if no base table named withdraw_requests remains) ———
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'withdraw_requests'
      AND c.relkind IN ('r', 'p')
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.withdraw_requests AS
      SELECT
        id,
        user_id,
        amount,
        CASE
          WHEN status = 'paid' THEN 'approved'::text
          ELSE status
        END AS status,
        created_at,
        note
      FROM public.ervenow_withdraw_requests
    $v$;
    COMMENT ON VIEW public.withdraw_requests IS
      'COMPAT VIEW — maps to ervenow_withdraw_requests (read). Prefer inserts on ervenow_withdraw_requests.';
  ELSIF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind = 'v'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.withdraw_requests AS
      SELECT
        id,
        user_id,
        amount,
        CASE WHEN status = 'paid' THEN 'approved'::text ELSE status END AS status,
        created_at,
        processed_at,
        note
      FROM public.ervenow_withdraw_requests
    $v$;
  END IF;
END $$;

-- ——— INSTEAD OF INSERT for compatibility (wallet routes may insert into withdraw_requests) ———
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
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.user_id,
    NEW.amount,
    NULL,
    COALESCE(NEW.status, 'pending'),
    NEW.note,
    COALESCE(NEW.created_at, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdraw_requests_view_insert ON public.withdraw_requests;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind = 'v'
  ) THEN
    CREATE TRIGGER trg_withdraw_requests_view_insert
      INSTEAD OF INSERT ON public.withdraw_requests
      FOR EACH ROW EXECUTE PROCEDURE public.withdraw_requests_view_insert();
  END IF;
END $$;

-- ——— Ledger approve RPC → canonical table ———
CREATE OR REPLACE FUNCTION public.ledger_withdraw_request_approve(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.ledger_withdraw_request_approve(uuid) IS
  'Approve withdraw — debits ervenow_ledger; reads/writes ervenow_withdraw_requests (canonical)';

NOTIFY pgrst, 'reload schema';
