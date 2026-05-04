-- ERVENOW — استرجاع عميل تشغيلي (ervenow_wallets / ervenow_wallet_transactions) ذرّي
-- نفّذ في Supabase SQL Editor بعد migration_ervenow_wallet_atomic_v2.sql (عمود status على الحركات).

alter table public.orders add column if not exists payment_status text;

comment on column public.orders.payment_status is 'حالة الدفع للواجهة — paid / captured / completed';

-- استرجاع إلى محفظة التشغيل للعميل بعد إلغاء طلب مدفوع (idempotent عبر note)
create or replace function public.ervenow_wallet_customer_refund_atomic(
  p_order_id uuid,
  p_customer_id uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  amt numeric(12, 2);
  v_note text;
  ps text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if o.customer_id is not null and o.customer_id <> p_customer_id then
    return jsonb_build_object('ok', false, 'reason', 'customer_mismatch');
  end if;

  ps := lower(trim(coalesce(o.payment_status, '')));
  if ps not in ('paid', 'captured', 'completed') then
    return jsonb_build_object('ok', false, 'reason', 'not_paid');
  end if;

  amt := round(
    coalesce(
      nullif(o.total_with_vat, 0)::numeric,
      coalesce(o.order_total, 0)::numeric + coalesce(o.delivery_fee, 0)::numeric
    ),
    2
  );

  if amt <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'zero_amount');
  end if;

  if round(coalesce(p_amount, 0)::numeric, 2) <> amt then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'expected', amt);
  end if;

  v_note := 'refund_customer_cancel:' || p_order_id::text;

  if exists (
    select 1
    from public.ervenow_wallet_transactions t
    where t.user_id = p_customer_id
      and t.type = 'earning'
      and t.note = v_note
      and coalesce(t.status, 'completed') = 'completed'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already_refunded', 'amount', amt);
  end if;

  insert into public.ervenow_wallet_transactions (user_id, amount, type, reference_id, note, status)
  values (p_customer_id, amt, 'earning', null, v_note, 'completed');

  insert into public.ervenow_wallets (user_id, role, balance, total_earned, total_withdrawn)
  values (p_customer_id, 'customer', amt, amt, 0)
  on conflict (user_id) do update set
    balance = public.ervenow_wallets.balance + excluded.balance,
    total_earned = public.ervenow_wallets.total_earned + excluded.balance;

  return jsonb_build_object('ok', true, 'reason', 'refunded', 'amount', amt);
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'reason', 'already_refunded');
end;
$$;

comment on function public.ervenow_wallet_customer_refund_atomic(uuid, uuid, numeric) is
  'استرجاع تشغيلي للعميل — حركة earning + تحديث ervenow_wallets (بدون تعديل من Node)';

grant execute on function public.ervenow_wallet_customer_refund_atomic(uuid, uuid, numeric) to authenticated, service_role;
