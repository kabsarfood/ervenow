-- =============================================================================
-- ERVENOW — دفتر محفظة موحّد (ervenow_ledger_*)
-- لا يُستبدل public.wallets / public.wallet_transactions (محاسبة قديمة).
-- الرصيد المخزَّن = نتيجة SUM للحركات المكتملة فقط (يُحدَّث تلقائياً بالمشغّل).
-- نفّذ في Supabase → SQL Editor بالكامل.
-- =============================================================================

-- ——— محافظ الدفتر ———
create table if not exists public.ervenow_ledger_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete restrict,
  role text not null
    check (role in ('customer', 'driver', 'store', 'merchant', 'admin', 'platform', 'service', 'restaurant')),
  is_platform boolean not null default false,
  balance numeric(14, 2) not null default 0 check (balance >= 0),
  currency text not null default 'SAR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ervenow_ledger_wallet_actor check (
    (is_platform = true and user_id is null)
    or (is_platform = false and user_id is not null)
  )
);

create unique index if not exists uq_ervenow_ledger_wallet_user_role
  on public.ervenow_ledger_wallets (user_id, role)
  where user_id is not null;

create unique index if not exists uq_ervenow_ledger_platform_singleton
  on public.ervenow_ledger_wallets (is_platform)
  where is_platform = true;

create index if not exists idx_ervenow_ledger_wallets_user on public.ervenow_ledger_wallets (user_id);

comment on table public.ervenow_ledger_wallets is 'محافظ الدفتر الموحّد — balance يُحدَّث من الحركات المكتملة فقط';

-- ——— حركات الدفتر ———
create table if not exists public.ervenow_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.ervenow_ledger_wallets (id) on delete restrict,
  type text not null
    check (type in ('deposit', 'withdraw', 'payment', 'refund', 'earning', 'commission', 'adjustment')),
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  reference_id text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ervenow_ledger_tx_wallet_created
  on public.ervenow_ledger_transactions (wallet_id, created_at desc);

create unique index if not exists uq_ervenow_ledger_tx_completed_ref
  on public.ervenow_ledger_transactions (wallet_id, reference_id)
  where reference_id is not null and status = 'completed';

comment on table public.ervenow_ledger_transactions is 'سجل حركات غير قابل للحذف — الرصيد = مجموع المكتمل';

-- ——— إعادة حساب الرصيد من الحركات المكتملة فقط ———
create or replace function public.ervenow_ledger_recalc_balance(p_wallet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v numeric(14, 2);
begin
  if p_wallet_id is null then
    return;
  end if;
  select round(coalesce(sum(
    case
      when t.status = 'completed' and t.direction = 'credit' then t.amount
      when t.status = 'completed' and t.direction = 'debit' then -t.amount
      else 0::numeric
    end
  ), 0)::numeric, 2)
  into v
  from public.ervenow_ledger_transactions t
  where t.wallet_id = p_wallet_id;

  if v < 0 then
    v := 0;
  end if;

  update public.ervenow_ledger_wallets w
  set balance = v, updated_at = now()
  where w.id = p_wallet_id;
end;
$$;

create or replace function public.ervenow_ledger_trg_refresh_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
begin
  wid := coalesce(new.wallet_id, old.wallet_id);
  if wid is not null then
    perform public.ervenow_ledger_recalc_balance(wid);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ervenow_ledger_tx_balance on public.ervenow_ledger_transactions;
create trigger trg_ervenow_ledger_tx_balance
  after insert or update of status, amount, direction on public.ervenow_ledger_transactions
  for each row execute procedure public.ervenow_ledger_trg_refresh_balance();

-- ——— محفظة المنصة (صف واحد) ———
insert into public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
select null, 'platform', true, 0, 'SAR'
where not exists (select 1 from public.ervenow_ledger_wallets w where w.is_platform = true);

-- ——— دور المستخدم → دور محفظة الدفتر ———
create or replace function public.ervenow_ledger_map_user_role(p_role text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_role, ''))
    when 'driver' then 'driver'
    when 'customer' then 'customer'
    when 'admin' then 'admin'
    when 'merchant' then 'store'
    when 'restaurant' then 'store'
    when 'store' then 'store'
    when 'service' then 'service'
    else 'customer'
  end;
$$;

-- ——— إنشاء أو جلب محفظة ———
create or replace function public.ervenow_ledger_ensure_wallet(p_user_id uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
  r text;
begin
  if p_user_id is null then
    raise exception 'ervenow_ledger_ensure_wallet: user_id required';
  end if;
  r := public.ervenow_ledger_map_user_role(p_role);
  select w.id into wid
  from public.ervenow_ledger_wallets w
  where w.user_id = p_user_id and w.role = r and w.is_platform = false
  limit 1;
  if wid is not null then
    return wid;
  end if;
  insert into public.ervenow_ledger_wallets (user_id, role, is_platform, balance, currency)
  values (p_user_id, r, false, 0, 'SAR')
  returning id into wid;
  return wid;
exception
  when unique_violation then
    select w.id into wid
    from public.ervenow_ledger_wallets w
    where w.user_id = p_user_id and w.role = r and w.is_platform = false
    limit 1;
    return wid;
end;
$$;

-- ——— إدراج حركة مكتملة مع منع التكرار (reference_id) ———
create or replace function public.ervenow_ledger_append_completed(
  p_wallet_id uuid,
  p_type text,
  p_direction text,
  p_amount numeric,
  p_reference_id text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_wallet_id is null or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', true, 'reason', 'skip_zero');
  end if;
  if p_reference_id is not null and exists (
    select 1 from public.ervenow_ledger_transactions t
    where t.wallet_id = p_wallet_id
      and t.reference_id = p_reference_id
      and t.status = 'completed'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'duplicate');
  end if;
  insert into public.ervenow_ledger_transactions (
    wallet_id, type, direction, amount, status, reference_id, description
  )
  values (
    p_wallet_id, p_type, p_direction, round(p_amount::numeric, 2), 'completed',
    p_reference_id, p_description
  );
  return jsonb_build_object('ok', true, 'reason', 'inserted');
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'reason', 'duplicate');
end;
$$;

-- ——— رصيد محفظة (مجموع مكتمل) ———
create or replace function public.ervenow_ledger_wallet_balance(p_wallet_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(w.balance, 0)::numeric, 2)
  from public.ervenow_ledger_wallets w
  where w.id = p_wallet_id;
$$;

-- ——— إيداع (ائتمان) ———
create or replace function public.ervenow_ledger_deposit(
  p_user_id uuid,
  p_role text,
  p_amount numeric,
  p_reference_id text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
begin
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, p_role);
  return public.ervenow_ledger_append_completed(
    wid, 'deposit', 'credit', p_amount, p_reference_id, coalesce(p_description, 'إيداع')
  );
end;
$$;

-- ——— دفع من محفظة العميل (خصم) ———
create or replace function public.ervenow_ledger_pay(
  p_user_id uuid,
  p_amount numeric,
  p_order_id uuid,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
  ref text;
  bal numeric(14, 2);
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, 'customer');
  bal := public.ervenow_ledger_wallet_balance(wid);
  if bal < round(p_amount::numeric, 2) then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal);
  end if;
  ref := 'pay:order:' || p_order_id::text;
  return public.ervenow_ledger_append_completed(
    wid, 'payment', 'debit', p_amount, ref, coalesce(p_description, 'دفع طلب')
  );
end;
$$;

-- ——— استرجاع (ائتمان) ———
create or replace function public.ervenow_ledger_refund(
  p_user_id uuid,
  p_amount numeric,
  p_reference_id text,
  p_description text,
  p_role text default 'customer'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
  r text;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;
  r := public.ervenow_ledger_map_user_role(coalesce(nullif(trim(p_role), ''), 'customer'));
  wid := public.ervenow_ledger_ensure_wallet(p_user_id, r);
  return public.ervenow_ledger_append_completed(
    wid, 'refund', 'credit', p_amount, p_reference_id, coalesce(p_description, 'استرجاع')
  );
end;
$$;

-- ——— تسوية طلب مُسلَّم: مندوب + منصة + تاجر (بدون خصم عميل — الدفع الخارجي) ———
create or replace function public.ervenow_ledger_settle_delivered_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  wid_driver uuid;
  wid_platform uuid;
  wid_merchant uuid;
  amt_driver numeric(14, 2);
  amt_platform numeric(14, 2);
  amt_merchant numeric(14, 2);
  driver_component numeric(14, 2);
  ref_prefix text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if lower(coalesce(o.delivery_status, o.status, '')) <> 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered');
  end if;

  ref_prefix := 'order:' || p_order_id::text;

  select w.id into wid_platform from public.ervenow_ledger_wallets w where w.is_platform = true limit 1;
  if wid_platform is null then
    return jsonb_build_object('ok', false, 'reason', 'platform_wallet_missing');
  end if;

  driver_component := round(coalesce(nullif(o.driver_earning, 0), nullif(o.delivery_fee, 0), 0)::numeric, 2);
  amt_driver := driver_component;
  amt_platform := round(coalesce(o.platform_fee, 0)::numeric, 2);

  amt_merchant := round(
    greatest(
      coalesce(o.total_amount, 0)::numeric - coalesce(amt_platform, 0) - coalesce(driver_component, 0),
      0
    ),
    2
  );

  if o.driver_id is not null and amt_driver > 0 then
    wid_driver := public.ervenow_ledger_ensure_wallet(o.driver_id, 'driver');
    perform public.ervenow_ledger_append_completed(
      wid_driver, 'earning', 'credit', amt_driver, ref_prefix || ':earning', 'أجر توصيل طلب'
    );
  end if;

  if amt_platform > 0 then
    perform public.ervenow_ledger_append_completed(
      wid_platform, 'commission', 'credit', amt_platform, ref_prefix || ':commission', 'عمولة منصة'
    );
  end if;

  if o.merchant_id is not null and amt_merchant > 0 then
    wid_merchant := public.ervenow_ledger_ensure_wallet(o.merchant_id, 'merchant');
    perform public.ervenow_ledger_append_completed(
      wid_merchant, 'deposit', 'credit', amt_merchant, ref_prefix || ':merchant', 'صافي تاجر'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'settled',
    'driver', amt_driver,
    'platform', amt_platform,
    'merchant', amt_merchant
  );
end;
$$;

-- ——— سحب إداري مرتبط بـ ervenow_withdraw_requests (نفس الجدول الحالي) ———
create or replace function public.ervenow_ledger_withdraw_atomic(p_withdraw_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  urole text;
  wid uuid;
  amt numeric(14, 2);
  bal numeric(14, 2);
  ref text;
begin
  select * into r from public.ervenow_withdraw_requests where id = p_withdraw_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  if r.status <> 'pending' then
    if r.status = 'approved' and exists (
      select 1 from public.ervenow_ledger_transactions t
      join public.ervenow_ledger_wallets w on w.id = t.wallet_id
      where t.type = 'withdraw'
        and t.direction = 'debit'
        and t.reference_id = 'wreq:' || p_withdraw_request_id::text
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

  select role into urole from public.users where id = r.user_id limit 1;
  wid := public.ervenow_ledger_ensure_wallet(r.user_id, coalesce(urole, 'driver'));
  bal := public.ervenow_ledger_wallet_balance(wid);
  if bal < amt then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'balance', bal, 'amount', amt);
  end if;

  ref := 'wreq:' || p_withdraw_request_id::text;
  if exists (
    select 1 from public.ervenow_ledger_transactions t
    where t.wallet_id = wid and t.reference_id = ref and t.status = 'completed'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already_processed');
  end if;

  insert into public.ervenow_ledger_transactions (
    wallet_id, type, direction, amount, status, reference_id, description
  )
  values (wid, 'withdraw', 'debit', amt, 'completed', ref, 'سحب (موافقة إدارية)');

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

alter table public.ervenow_ledger_wallets enable row level security;
alter table public.ervenow_ledger_transactions enable row level security;

drop policy if exists "ervenow_ledger_wallets_service" on public.ervenow_ledger_wallets;
create policy "ervenow_ledger_wallets_service" on public.ervenow_ledger_wallets
  for all to authenticated using (true) with check (true);

drop policy if exists "ervenow_ledger_tx_service" on public.ervenow_ledger_transactions;
create policy "ervenow_ledger_tx_service" on public.ervenow_ledger_transactions
  for all to authenticated using (true) with check (true);

grant select, insert, update on public.ervenow_ledger_wallets to authenticated, service_role;
grant select, insert, update on public.ervenow_ledger_transactions to authenticated, service_role;

grant execute on function public.ervenow_ledger_map_user_role(text) to authenticated, service_role;
grant execute on function public.ervenow_ledger_ensure_wallet(uuid, text) to authenticated, service_role;
grant execute on function public.ervenow_ledger_append_completed(uuid, text, text, numeric, text, text) to authenticated, service_role;
grant execute on function public.ervenow_ledger_recalc_balance(uuid) to authenticated, service_role;
grant execute on function public.ervenow_ledger_wallet_balance(uuid) to authenticated, service_role;
grant execute on function public.ervenow_ledger_deposit(uuid, text, numeric, text, text) to authenticated, service_role;
grant execute on function public.ervenow_ledger_pay(uuid, numeric, uuid, text) to authenticated, service_role;
grant execute on function public.ervenow_ledger_refund(uuid, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.ervenow_ledger_settle_delivered_order(uuid) to authenticated, service_role;
grant execute on function public.ervenow_ledger_withdraw_atomic(uuid) to authenticated, service_role;
