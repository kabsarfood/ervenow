-- ERWENOW — نظام مالي ومحاسبي (محفظة + تسوية + استرجاع)
-- نفّذ في Supabase SQL Editor بعد schema.sql الأساسي.
-- الخادم يستخدم SERVICE ROLE ويتجاوز RLS؛ تُشدد السياسات لاحقاً للوصول المباشر من العملاء.

-- ——— توسيع المستخدمين (متعدد الدول + أدوار المنصة) ———
alter table public.users add column if not exists name text;
alter table public.users add column if not exists country_code text default 'SA';
alter table public.users add column if not exists city text;

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('customer', 'merchant', 'driver', 'service', 'admin', 'restaurant'));

comment on column public.users.role is 'restaurant يُعامل كـ merchant في طبقة المالية عند الربط';

-- ——— عمولات قابلة للتوسع ———
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  commission_rate numeric(8, 6) not null check (commission_rate >= 0 and commission_rate <= 1),
  applies_to text not null check (applies_to in ('merchant', 'service', 'delivery')),
  country_code text default 'SA',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commission_active on public.commission_rules (is_active, applies_to, country_code);

-- ——— محافظ ———
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.users (id) on delete restrict,
  owner_type text not null check (owner_type in ('customer', 'merchant', 'driver', 'service', 'platform')),
  balance numeric(14, 2) not null default 0 check (balance >= 0),
  currency_code text not null default 'SAR',
  country_code text default 'SA',
  allow_overdraft boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- محفظة المنصة: owner_id فارغ
create unique index if not exists wallets_platform_singleton
  on public.wallets (owner_type)
  where owner_type = 'platform' and owner_id is null;

create unique index if not exists wallets_owner_unique
  on public.wallets (owner_id, owner_type, country_code)
  where owner_id is not null;

create index if not exists idx_wallets_owner on public.wallets (owner_id, owner_type);

-- ——— حركات المحفظة (المصدر الوحيد لتغيير الرصيد عبر المشغّل) ———
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id) on delete restrict,
  type text not null check (type in ('credit', 'debit')),
  amount numeric(14, 2) not null check (amount > 0),
  description text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_tx_wallet on public.wallet_transactions (wallet_id, created_at desc);
create index if not exists idx_wallet_tx_ref on public.wallet_transactions (reference_id);

-- ——— طلبات مالية موحّدة (orders حسب المواصفات) ———
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id),
  merchant_id uuid references public.users (id),
  driver_id uuid references public.users (id),
  service_provider_id uuid references public.users (id),
  delivery_order_id uuid references public.delivery_orders (id),
  country_code text not null default 'SA',
  city text,
  currency_code text not null default 'SAR',
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  delivery_fee numeric(14, 2) not null default 0 check (delivery_fee >= 0),
  status text not null default 'new'
    check (status in ('new', 'accepted', 'onroad', 'delivered', 'cancelled')),
  breakdown jsonb not null default '{}'::jsonb,
  settled_at timestamptz,
  cancelled_at timestamptz,
  refund_of_settlement boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fin_orders_customer on public.orders (customer_id);
create index if not exists idx_fin_orders_delivery on public.orders (delivery_order_id);
create index if not exists idx_fin_orders_status on public.orders (status);

-- ——— سحوبات ———
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id),
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  bank_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_withdrawals_wallet on public.withdrawals (wallet_id, status);

-- ——— استرجاع ———
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  amount numeric(14, 2) not null check (amount > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  wallet_tx_id uuid references public.wallet_transactions (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_refunds_order on public.refunds (order_id);

-- ——— محفظة المنصة الافتراضية ———
insert into public.wallets (owner_id, owner_type, balance, currency_code, allow_overdraft)
select null, 'platform', 0, 'SAR', true
where not exists (
  select 1 from public.wallets w where w.owner_type = 'platform' and w.owner_id is null
);

-- ——— قواعد عمولة افتراضية ———
insert into public.commission_rules (commission_rate, applies_to, country_code, is_active)
select 0.12, v.applies, 'SA', true
from (values ('merchant'::text), ('delivery'::text), ('service'::text)) as v(applies)
where not exists (
  select 1 from public.commission_rules c where c.applies_to = v.applies and c.country_code = 'SA' and c.is_active
);

-- ——— مشغّل: تحديث الرصيد من الحركات فقط ———
create or replace function public.erwenow_wallet_apply_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select * into w from public.wallets where id = new.wallet_id for update;
  if not found then
    raise exception 'WALLET_NOT_FOUND';
  end if;

  if new.type = 'credit' then
    update public.wallets
      set balance = balance + new.amount, updated_at = now()
      where id = new.wallet_id;
  elsif new.type = 'debit' then
    if not coalesce(w.allow_overdraft, false) and w.balance < new.amount then
      raise exception 'INSUFFICIENT_FUNDS';
    end if;
    update public.wallets
      set balance = balance - new.amount, updated_at = now()
      where id = new.wallet_id;
  else
    raise exception 'INVALID_TX_TYPE';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_wallet_transactions_balance on public.wallet_transactions;
create trigger tr_wallet_transactions_balance
  after insert on public.wallet_transactions
  for each row execute procedure public.erwenow_wallet_apply_balance();

-- ——— إدراج حركة (للاستدعاء من دوال التسوية) ———
create or replace function public.erwenow_fn_wallet_tx(
  p_wallet_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_reference_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_wallet_id is null or p_amount is null or p_amount <= 0 then
    return null;
  end if;
  insert into public.wallet_transactions (wallet_id, type, amount, description, reference_id, metadata)
  values (p_wallet_id, p_type, p_amount, p_description, p_reference_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- ——— جلب أو إنشاء محفظة ———
create or replace function public.erwenow_fn_ensure_wallet(
  p_owner_id uuid,
  p_owner_type text,
  p_country text default 'SA',
  p_currency text default 'SAR'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare wid uuid;
begin
  if p_owner_type = 'platform' then
    select id into wid from public.wallets
      where owner_type = 'platform' and owner_id is null limit 1;
    if wid is null then
      insert into public.wallets (owner_id, owner_type, balance, country_code, currency_code, allow_overdraft)
      values (null, 'platform', 0, p_country, p_currency, true)
      returning id into wid;
    end if;
    return wid;
  end if;

  if p_owner_id is null then
    return null;
  end if;

  select id into wid from public.wallets
    where owner_id = p_owner_id and owner_type = p_owner_type
      and (country_code is not distinct from p_country or country_code = p_country)
    limit 1;

  if wid is null then
    insert into public.wallets (owner_id, owner_type, balance, country_code, currency_code)
    values (p_owner_id, p_owner_type, 0, p_country, p_currency)
    returning id into wid;
  end if;
  return wid;
end;
$$;

-- ——— تسوية عند التسليم (موزّع تلقائياً) ———
create or replace function public.erwenow_finance_settle_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  b jsonb;
  pf numeric; dpf numeric; dn numeric; mn numeric; pt numeric; pv numeric;
  w_platform uuid;
  w_merchant uuid;
  w_driver uuid;
  cc text;
  cur text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if o.status <> 'delivered' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_DELIVERED', 'status', o.status);
  end if;
  if o.settled_at is not null then
    return jsonb_build_object('ok', true, 'already_settled', true, 'settled_at', o.settled_at);
  end if;

  b := coalesce(o.breakdown, '{}'::jsonb);
  pf := coalesce((b->>'platform_fee')::numeric, 0);
  dpf := coalesce((b->>'delivery_platform_fee')::numeric, 0);
  dn := coalesce((b->>'driver_net')::numeric, 0);
  mn := coalesce((b->>'merchant_net')::numeric, 0);
  pt := coalesce((b->>'platform_total')::numeric, pf + dpf);
  pv := coalesce((b->>'platform_vat_on_commission')::numeric, 0);

  cc := coalesce(o.country_code, 'SA');
  cur := coalesce(o.currency_code, 'SAR');

  w_platform := public.erwenow_fn_ensure_wallet(null, 'platform', cc, cur);

  if mn > 0 then
    if o.merchant_id is not null then
      w_merchant := public.erwenow_fn_ensure_wallet(o.merchant_id, 'merchant', cc, cur);
      perform public.erwenow_fn_wallet_tx(w_merchant, 'credit', mn, 'تسوية طلب — صافي التاجر', p_order_id,
        jsonb_build_object('kind', 'merchant_settlement'));
    elsif o.service_provider_id is not null then
      w_merchant := public.erwenow_fn_ensure_wallet(o.service_provider_id, 'service', cc, cur);
      perform public.erwenow_fn_wallet_tx(w_merchant, 'credit', mn, 'تسوية طلب — صافي مقدم الخدمة', p_order_id,
        jsonb_build_object('kind', 'service_settlement'));
    end if;
  end if;

  if o.driver_id is not null and dn > 0 then
    w_driver := public.erwenow_fn_ensure_wallet(o.driver_id, 'driver', cc, cur);
    perform public.erwenow_fn_wallet_tx(w_driver, 'credit', dn, 'تسوية طلب — صافي المندوب', p_order_id,
      jsonb_build_object('kind', 'driver_settlement'));
  end if;

  -- صافي المنصة (عمولة السلعة + عمولة التوصيل)؛ ضريبة العمولة تُسجّل كحركة منفصلة إن وُجدت
  if pt > 0 then
    perform public.erwenow_fn_wallet_tx(w_platform, 'credit', pt, 'تسوية طلب — عمولة المنصة', p_order_id,
      jsonb_build_object('kind', 'platform_commission'));
  end if;

  if pv > 0 then
    perform public.erwenow_fn_wallet_tx(w_platform, 'credit', pv, 'ضريبة على عمولة المنصة (VAT)', p_order_id,
      jsonb_build_object('kind', 'platform_vat'));
  end if;

  update public.orders
    set settled_at = now(), updated_at = now()
    where id = p_order_id;

  return jsonb_build_object('ok', true, 'settled', true, 'platform_total', pt, 'platform_vat', pv);
end;
$$;

-- ——— استرجاع: عكس التسوية + إيداع للعميل ———
create or replace function public.erwenow_finance_refund_order(
  p_order_id uuid,
  p_reason text,
  p_customer_credit numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  b jsonb;
  pf numeric; dpf numeric; dn numeric; mn numeric; pt numeric; pv numeric;
  w_platform uuid;
  w_merchant uuid;
  w_driver uuid;
  w_customer uuid;
  refund_amt numeric;
  cc text;
  cur text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if coalesce(o.refund_of_settlement, false) then
    return jsonb_build_object('ok', true, 'already_refunded', true);
  end if;
  if o.status <> 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CANCELLED', 'status', o.status);
  end if;

  b := coalesce(o.breakdown, '{}'::jsonb);
  pf := coalesce((b->>'platform_fee')::numeric, 0);
  dpf := coalesce((b->>'delivery_platform_fee')::numeric, 0);
  dn := coalesce((b->>'driver_net')::numeric, 0);
  mn := coalesce((b->>'merchant_net')::numeric, 0);
  pt := coalesce((b->>'platform_total')::numeric, pf + dpf);
  pv := coalesce((b->>'platform_vat_on_commission')::numeric, 0);

  refund_amt := coalesce(p_customer_credit, o.total_amount + o.delivery_fee);
  if refund_amt < 0 then
    refund_amt := 0;
  end if;

  cc := coalesce(o.country_code, 'SA');
  cur := coalesce(o.currency_code, 'SAR');

  w_platform := public.erwenow_fn_ensure_wallet(null, 'platform', cc, cur);
  w_customer := public.erwenow_fn_ensure_wallet(o.customer_id, 'customer', cc, cur);

  if o.settled_at is not null then
    if mn > 0 then
      if o.merchant_id is not null then
        w_merchant := public.erwenow_fn_ensure_wallet(o.merchant_id, 'merchant', cc, cur);
        perform public.erwenow_fn_wallet_tx(w_merchant, 'debit', mn, 'استرجاع — عكس صافي التاجر', p_order_id,
          jsonb_build_object('kind', 'refund_reverse_merchant'));
      elsif o.service_provider_id is not null then
        w_merchant := public.erwenow_fn_ensure_wallet(o.service_provider_id, 'service', cc, cur);
        perform public.erwenow_fn_wallet_tx(w_merchant, 'debit', mn, 'استرجاع — عكس صافي مقدم الخدمة', p_order_id,
          jsonb_build_object('kind', 'refund_reverse_service'));
      end if;
    end if;
    if o.driver_id is not null and dn > 0 then
      w_driver := public.erwenow_fn_ensure_wallet(o.driver_id, 'driver', cc, cur);
      perform public.erwenow_fn_wallet_tx(w_driver, 'debit', dn, 'استرجاع — عكس صافي المندوب', p_order_id,
        jsonb_build_object('kind', 'refund_reverse_driver'));
    end if;
    if pt > 0 then
      perform public.erwenow_fn_wallet_tx(w_platform, 'debit', pt, 'استرجاع — عكس عمولة المنصة', p_order_id,
        jsonb_build_object('kind', 'refund_reverse_platform'));
    end if;
    if pv > 0 then
      perform public.erwenow_fn_wallet_tx(w_platform, 'debit', pv, 'استرجاع — عكس ضريبة العمولة', p_order_id,
        jsonb_build_object('kind', 'refund_reverse_vat'));
    end if;
  end if;

  if refund_amt > 0 then
    perform public.erwenow_fn_wallet_tx(w_customer, 'credit', refund_amt, coalesce(p_reason, 'استرجاع للعميل'), p_order_id,
      jsonb_build_object('kind', 'customer_refund'));
  end if;

  update public.orders
    set refund_of_settlement = true, updated_at = now(), cancelled_at = coalesce(cancelled_at, now())
    where id = p_order_id;

  return jsonb_build_object('ok', true, 'refunded', true, 'customer_credit', refund_amt);
end;
$$;

-- ——— RLS (اختياري — الخادم يستخدم service role) ———
alter table public.commission_rules enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.orders enable row level security;
alter table public.withdrawals enable row level security;
alter table public.refunds enable row level security;

drop policy if exists "finance_service_all_commission" on public.commission_rules;
drop policy if exists "finance_service_all_wallets" on public.wallets;
drop policy if exists "finance_service_all_wallettx" on public.wallet_transactions;
drop policy if exists "finance_service_all_orders" on public.orders;
drop policy if exists "finance_service_all_withdrawals" on public.withdrawals;
drop policy if exists "finance_service_all_refunds" on public.refunds;

create policy "finance_service_all_commission" on public.commission_rules for all to authenticated using (true) with check (true);
create policy "finance_service_all_wallets" on public.wallets for all to authenticated using (true) with check (true);
create policy "finance_service_all_wallettx" on public.wallet_transactions for all to authenticated using (true) with check (true);
create policy "finance_service_all_orders" on public.orders for all to authenticated using (true) with check (true);
create policy "finance_service_all_withdrawals" on public.withdrawals for all to authenticated using (true) with check (true);
create policy "finance_service_all_refunds" on public.refunds for all to authenticated using (true) with check (true);
