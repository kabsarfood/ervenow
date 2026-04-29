-- توحيد الطلبات: نقل بيانات التوصيل إلى جدول orders
alter table public.orders
add column if not exists delivery_status text default 'pending',
add column if not exists driver_id uuid references public.users (id),
add column if not exists driver_lat numeric,
add column if not exists driver_lng numeric,
add column if not exists last_location_at timestamptz,
add column if not exists delivery_fee numeric default 0,
add column if not exists external_order_id text,
add column if not exists series_source text,
add column if not exists customer_phone text,
add column if not exists pickup_address text,
add column if not exists drop_address text,
add column if not exists pickup_lat numeric,
add column if not exists pickup_lng numeric,
add column if not exists drop_lat numeric,
add column if not exists drop_lng numeric,
add column if not exists distance_km numeric,
add column if not exists notes text,
add column if not exists order_number text,
add column if not exists platform_fee numeric default 0,
add column if not exists order_total numeric default 0,
add column if not exists driver_earning numeric default 0,
add column if not exists vat_amount numeric default 0,
add column if not exists total_with_vat numeric default 0,
add column if not exists rating integer,
add column if not exists review text,
add column if not exists invoice_number text,
add column if not exists invoice_issued_at timestamptz,
add column if not exists seller_name text default 'ERVENOW',
add column if not exists seller_vat_number text,
add column if not exists invoice_url text,
add column if not exists wallet_credited_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_status_check'
  ) then
    alter table public.orders
      add constraint orders_delivery_status_check
      check (delivery_status in ('new', 'pending', 'accepted', 'delivering', 'delivered', 'cancelled'));
  end if;
end $$;

create index if not exists idx_orders_delivery_status on public.orders (delivery_status);
create index if not exists idx_orders_driver on public.orders (driver_id);
create index if not exists idx_orders_order_number on public.orders (order_number);
create unique index if not exists idx_orders_external_order_unique
  on public.orders (external_order_id)
  where external_order_id is not null;
create unique index if not exists idx_orders_order_number_unique
  on public.orders (order_number)
  where order_number is not null;
create unique index if not exists idx_orders_invoice_number_unique
  on public.orders (invoice_number)
  where invoice_number is not null;
