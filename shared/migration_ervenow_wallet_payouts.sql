-- محفظة سحب ERVENOW (مندوب / متجر / مقدم خدمة)
-- الأسماء: ervenow_wallets — لأن جدول public.wallets قد يكون محجوزاً لنظام المحاسبة (migration_finance_accounting.sql).
-- الوظائف نفس «wallets / withdraw_requests / wallet_transactions» في المواصفات.
-- نفّذ في Supabase SQL Editor بعد الاعتماد

alter table public.users
  add column if not exists iban text,
  add column if not exists bank_name text;

alter table public.delivery_orders
  add column if not exists driver_earning numeric(12, 2) default 0,
  add column if not exists wallet_credited_at timestamptz;

create table if not exists public.ervenow_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  role text,
  balance numeric(12, 2) not null default 0,
  total_earned numeric(12, 2) not null default 0,
  total_withdrawn numeric(12, 2) not null default 0,
  created_at timestamptz default now(),
  unique (user_id)
);

create index if not exists idx_ervenow_wallets_user on public.ervenow_wallets (user_id);

create table if not exists public.ervenow_withdraw_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount numeric(12, 2) not null,
  iban text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  note text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists idx_ervenow_withdraw_user on public.ervenow_withdraw_requests (user_id, status);

create table if not exists public.ervenow_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount numeric(12, 2) not null,
  type text not null check (type in ('earning', 'withdraw')),
  reference_id uuid,
  note text,
  created_at timestamptz default now()
);

create unique index if not exists uq_ervenow_wallet_tx_earning_per_order
  on public.ervenow_wallet_transactions (reference_id)
  where type = 'earning' and reference_id is not null;

create or replace function public.ervenow_increment_wallet_balance(p_user_id uuid, p_amount numeric, p_role text)
returns void
language plpgsql
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  insert into public.ervenow_wallets (user_id, role, balance, total_earned)
  values (p_user_id, p_role, p_amount, p_amount)
  on conflict (user_id) do update set
    balance = public.ervenow_wallets.balance + excluded.balance,
    total_earned = public.ervenow_wallets.total_earned + excluded.balance;
end;
$$;

-- إيداع أجر المندوب مرة واحدة عند delivered (حماية من التكرار)
create or replace function public.ervenow_credit_driver_for_delivery(p_order_id uuid)
returns boolean
language plpgsql
as $$
declare
  o public.delivery_orders%rowtype;
  amt numeric(12, 2);
begin
  select * into o from public.delivery_orders where id = p_order_id for update;
  if not found then
    return false;
  end if;
  if o.wallet_credited_at is not null or o.status <> 'delivered' or o.driver_id is null then
    return false;
  end if;
  amt := coalesce(nullif(o.driver_earning, 0::numeric), o.delivery_fee, 0);
  if amt is null or amt <= 0 then
    update public.delivery_orders set wallet_credited_at = now(), updated_at = now() where id = p_order_id;
    return true;
  end if;
  insert into public.ervenow_wallet_transactions (user_id, amount, type, reference_id, note)
  values (o.driver_id, amt, 'earning', p_order_id, 'توصيل طلب');
  perform public.ervenow_increment_wallet_balance(o.driver_id, amt, 'driver');
  update public.delivery_orders
  set wallet_credited_at = now(), updated_at = now()
  where id = p_order_id;
  return true;
exception
  when unique_violation then
    return false;
end;
$$;

alter table public.ervenow_wallets enable row level security;
alter table public.ervenow_withdraw_requests enable row level security;
alter table public.ervenow_wallet_transactions enable row level security;

drop policy if exists "ervenow_wallets_service" on public.ervenow_wallets;
create policy "ervenow_wallets_service" on public.ervenow_wallets for all to authenticated using (true) with check (true);

drop policy if exists "ervenow_withdraw_service" on public.ervenow_withdraw_requests;
create policy "ervenow_withdraw_service" on public.ervenow_withdraw_requests for all to authenticated using (true) with check (true);

drop policy if exists "ervenow_wtx_service" on public.ervenow_wallet_transactions;
create policy "ervenow_wtx_service" on public.ervenow_wallet_transactions for all to authenticated using (true) with check (true);
