-- ERWENOW Platform Core — نفّذ في Supabase SQL Editor
-- بعدها (للمحفظة والمحاسبة): shared/migration_finance_accounting.sql
-- ثم فعّل Realtime لجدول delivery_orders (Database → Replication)
--
-- تسجيل الدخول بـ OTP واتساب (Twilio) بدون Supabase Auth:
-- بعد إنشاء الجداول، نفّذ أيضاً: shared/migration_users_phone_auth.sql

create extension if not exists "uuid-ossp";

-- ملف المستخدمين (تثبيت جديد: بدون ربط auth.users — لاستخدام OTP المنصة)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text,
  role text not null default 'customer'
    check (role in ('driver', 'customer', 'admin', 'restaurant')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists users_phone_unique on public.users (phone)
  where phone is not null and phone <> '';

-- طلبات التوصيل
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.users (id),
  customer_phone text,
  pickup_address text,
  drop_address text,
  notes text,
  status text not null default 'new'
    check (status in ('new', 'accepted', 'delivering', 'delivered')),
  driver_id uuid references public.users (id),
  driver_lat double precision,
  driver_lng double precision,
  last_location_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_delivery_status on public.delivery_orders (status);
create index if not exists idx_delivery_driver on public.delivery_orders (driver_id);

-- طلبات المطعم (مبسّط)
create table if not exists public.food_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.users (id),
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2),
  status text not null default 'new',
  delivery_order_id uuid references public.delivery_orders (id),
  created_at timestamptz default now()
);

-- عناصر قائمة (اختياري)
create table if not exists public.food_menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null default 0,
  active boolean default true,
  created_at timestamptz default now()
);

-- متجر / خدمات (جداول بذرة للتوسع)
create table if not exists public.market_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) default 0,
  active boolean default true
);

create table if not exists public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.users (id),
  service_name text,
  status text default 'new',
  created_at timestamptz default now()
);

-- RLS — صلاحيات واسعة لـ MVP مع مستخدم مسجّل (شدّدها في الإنتاج)
alter table public.users enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.food_orders enable row level security;
alter table public.food_menu_items enable row level security;
alter table public.market_products enable row level security;
alter table public.service_bookings enable row level security;

create policy "users_select_self" on public.users for select using (auth.uid() = id);
create policy "users_insert_self" on public.users for insert with check (auth.uid() = id);
create policy "users_update_self" on public.users for update using (auth.uid() = id);

create policy "delivery_select_auth" on public.delivery_orders for select to authenticated using (true);
create policy "delivery_insert_auth" on public.delivery_orders for insert to authenticated with check (true);
create policy "delivery_update_auth" on public.delivery_orders for update to authenticated using (true);

create policy "food_orders_auth" on public.food_orders for all to authenticated using (true) with check (true);
create policy "food_menu_read" on public.food_menu_items for select to authenticated using (true);
create policy "food_menu_admin" on public.food_menu_items for all to authenticated using (true) with check (true);

create policy "market_read" on public.market_products for select to authenticated using (active = true);
create policy "service_bookings_auth" on public.service_bookings for all to authenticated using (true) with check (true);
