-- ERVENOW: محفظة ذرية كاملة — حركات + status + RPC (إيداع مندوب + سحب إداري)
-- نفّذ الملف كاملاً في Supabase SQL Editor (Dashboard → SQL).
-- بعد التنفيذ: التطبيق يعتمد على RPC فقط (لا fallback في Node لـ applyDriverOrderEarning / موافقة السحب).

alter table public.ervenow_wallet_transactions
  add column if not exists status text not null default 'completed'
  check (status in ('pending', 'completed', 'failed'));

update public.ervenow_wallet_transactions
set status = 'completed'
where status is null;

comment on column public.ervenow_wallet_transactions.status is 'حالة الحركة: pending | completed | failed';

-- إيداع أجر مندوب لطلب مُسلَّم (ذرّي: تحقق + insert حركة + تحديث رصيد المحفظة)
create or replace function public.ervenow_wallet_apply_driver_order_earning(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  amt numeric(12, 2);
  v_user_id uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if lower(coalesce(o.delivery_status, o.status, '')) <> 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;

  if o.driver_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_driver');
  end if;

  v_user_id := o.driver_id;
  amt := round(coalesce(nullif(o.driver_earning, 0), nullif(o.delivery_fee, 0), 0)::numeric, 2);

  if amt <= 0 then
    return jsonb_build_object('ok', true, 'reason', 'zero_amount', 'amount', 0);
  end if;

  if exists (
    select 1
    from public.ervenow_wallet_transactions t
    where t.user_id = v_user_id
      and t.type = 'earning'
      and t.reference_id = p_order_id
      and t.status = 'completed'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already_credited', 'amount', amt);
  end if;

  insert into public.ervenow_wallet_transactions (user_id, amount, type, reference_id, note, status)
  values (v_user_id, amt, 'earning', p_order_id, 'توصيل طلب', 'completed');

  insert into public.ervenow_wallets (user_id, role, balance, total_earned, total_withdrawn)
  values (v_user_id, 'driver', amt, amt, 0)
  on conflict (user_id) do update set
    balance = public.ervenow_wallets.balance + excluded.balance,
    total_earned = public.ervenow_wallets.total_earned + excluded.balance;

  return jsonb_build_object('ok', true, 'reason', 'credited', 'amount', amt);
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'reason', 'already_credited');
end;
$$;

comment on function public.ervenow_wallet_apply_driver_order_earning(uuid) is
  'إيداع أجر مندوب لطلب مُسلَّم على orders — بدون تكرار (reference_id + type earning)';

-- رصيد مشتق من الحركات المكتملة (للمراجعة والتدقيق؛ balance يبقى للتوافق)
create or replace function public.ervenow_wallet_ledger_balance(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(
    sum(case when type = 'earning' and status = 'completed' then amount
             when type = 'withdraw' and status = 'completed' then -amount
             else 0 end), 0
  )::numeric, 2)
  from public.ervenow_wallet_transactions
  where user_id = p_user_id;
$$;

grant execute on function public.ervenow_wallet_apply_driver_order_earning(uuid) to authenticated, service_role;
grant execute on function public.ervenow_wallet_ledger_balance(uuid) to authenticated, service_role;

-- لا تكرار لحركة سحب مرتبطة بنفس طلب السحب (idempotency)
create unique index if not exists uq_ervenow_wallet_tx_withdraw_per_request
  on public.ervenow_wallet_transactions (reference_id)
  where type = 'withdraw' and reference_id is not null;

-- سحب ذري: قفل طلب السحب + المحفظة، تحقق من الرصيد، insert حركة، تحديث الرصيد، تحديث حالة الطلب
create or replace function public.ervenow_wallet_withdraw_atomic(p_withdraw_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  w record;
  amt numeric(12, 2);
  bal numeric(12, 2);
begin
  select * into r from public.ervenow_withdraw_requests where id = p_withdraw_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  if r.status <> 'pending' then
    if r.status = 'approved' and exists (
      select 1
      from public.ervenow_wallet_transactions t
      where t.type = 'withdraw'
        and t.reference_id = p_withdraw_request_id
        and t.status = 'completed'
    ) then
      return jsonb_build_object('ok', true, 'reason', 'already_processed');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', r.status);
  end if;

  amt := round(coalesce(r.amount, 0)::numeric, 2);
  if amt <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  if exists (
    select 1
    from public.ervenow_wallet_transactions t
    where t.type = 'withdraw'
      and t.reference_id = p_withdraw_request_id
      and t.status = 'completed'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already_processed');
  end if;

  select * into w from public.ervenow_wallets where user_id = r.user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', 0, 'amount', amt);
  end if;

  bal := round(coalesce(w.balance, 0)::numeric, 2);
  if bal < amt then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal, 'amount', amt);
  end if;

  insert into public.ervenow_wallet_transactions (user_id, amount, type, reference_id, note, status)
  values (r.user_id, amt, 'withdraw', p_withdraw_request_id, 'سحب (موافقة إدارية)', 'completed');

  update public.ervenow_wallets
  set
    balance = round(balance - amt, 2),
    total_withdrawn = round(coalesce(total_withdrawn, 0) + amt, 2)
  where user_id = r.user_id;

  update public.ervenow_withdraw_requests
  set
    status = 'approved',
    processed_at = now(),
    note = coalesce(r.note, '') || ' | OK'
  where id = p_withdraw_request_id;

  return jsonb_build_object('ok', true, 'reason', 'debited', 'amount', amt);
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'reason', 'already_processed');
end;
$$;

comment on function public.ervenow_wallet_withdraw_atomic(uuid) is
  'موافقة إدارية على سحب: حركة completed + خصم الرصيد + تحديث الطلب — ذرّي وidempotent';

grant execute on function public.ervenow_wallet_withdraw_atomic(uuid) to authenticated, service_role;
