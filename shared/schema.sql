-- ERVENOW Platform Core — نفّذ في Supabase SQL Editor
-- فواتير PDF: shared/migration_delivery_orders_invoice.sql
-- تفريد فاتورة/VAT: shared/migration_finance_production_hardening.sql
-- تاريخ الرياض للـ VAT: shared/migration_vat_riyadh_production.sql
-- Kabsar / POS: shared/migration_kabsar_external_order.sql
-- بعدها (للمحفظة والمحاسبة): shared/migration_finance_accounting.sql
-- ثم فعّل Realtime لجدول delivery_orders (Database → Replication)
--
-- تسجيل الدخول بـ OTP واتساب (Twilio) بدون Supabase Auth:
-- بعد إنشاء الجداول، نفّذ أيضاً: shared/migration_users_phone_auth.sql
-- إن كان جدول users قديماً بلا updated_at: shared/migration_users_add_timestamps.sql

create extension if not exists "uuid-ossp";

-- ملف المستخدمين (تثبيت جديد: بدون ربط auth.users — لاستخدام OTP المنصة)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text,
  iban text,
  bank_name text,
  role text not null default 'customer'
    check (role in ('driver', 'customer', 'admin', 'restaurant')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists users_phone_unique on public.users (phone)
  where phone is not null and phone <> '';

-- طلبات التوصيل — delivery_orders
-- نفس *اسم* الجدول مُستخدَم في مشروعين:
--   (1) ERVENOW — هذا الملف؛ تملأه فقط واجهات خادم ERVENOW (مثل POST /api/delivery/orders) عندما
--       يشير .env لنفس مشروع Supabase.
--   (2) نفس اسم الجدول قد يُستعمل في بيئات/مشاريع أخرى — كل مشروع لجدول Supabase الخاص به ما لم تُوحَّد الاتصالات.
-- الاسم متشابه لأن نفس نموذج العمل (طابور التوصيل)، لكنهما جدولان منطقياً في قاعدتين
-- إلا إذا وُحّد URL المشروع والمفاتيح.
create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.users (id),
  customer_phone text,
  pickup_address text,
  drop_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  drop_lat double precision,
  drop_lng double precision,
  distance_km double precision,
  delivery_fee numeric(12, 2),
  platform_fee numeric(12, 2),
  order_total numeric(12, 2),
  driver_earning numeric(12, 2),
  vat_amount numeric(12, 2) default 0,
  total_with_vat numeric(12, 2),
  wallet_credited_at timestamptz,
  notes text,
  order_number text,
  status text not null default 'pending'
    check (status in ('new', 'pending', 'accepted', 'delivering', 'delivered', 'cancelled')),
  driver_id uuid references public.users (id),
  driver_lat double precision,
  driver_lng double precision,
  last_location_at timestamptz,
  rating integer,
  review text,
  invoice_number text,
  invoice_issued_at timestamptz,
  seller_name text default 'ERVENOW',
  seller_vat_number text,
  invoice_url text,
  external_order_id text,
  series_source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint unique_order_number unique (order_number),
  constraint delivery_orders_invoice_number_key unique (invoice_number)
);

create index if not exists idx_delivery_status on public.delivery_orders (status);
create index if not exists idx_delivery_driver on public.delivery_orders (driver_id);

create unique index if not exists idx_ext_order_unique
  on public.delivery_orders (external_order_id)
  where external_order_id is not null;

-- سجل اختياري لضريبة القيمة المضافة (مرجع/تدقيق)
create table if not exists public.vat_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.delivery_orders (id) on delete set null,
  vat_amount numeric(12, 2),
  subtotal numeric(12, 2),
  vat_date date default (current_date),
  vat_date_riyadh date,
  created_at timestamptz default now(),
  unique (order_id)
);

create index if not exists idx_vat_records_order on public.vat_records (order_id);

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
alter table public.vat_records enable row level security;

create policy "users_select_self" on public.users for select using (auth.uid() = id);
create policy "users_insert_self" on public.users for insert with check (auth.uid() = id);
create policy "users_update_self" on public.users for update using (auth.uid() = id);

create policy "delivery_select_auth" on public.delivery_orders for select to authenticated using (true);
create policy "delivery_insert_auth" on public.delivery_orders for insert to authenticated with check (true);
create policy "delivery_update_auth" on public.delivery_orders for update to authenticated using (true);

create policy "vat_records_select_auth" on public.vat_records for select to authenticated using (true);
create policy "vat_records_insert_auth" on public.vat_records for insert to authenticated with check (true);
create policy "vat_records_update_auth" on public.vat_records for update to authenticated using (true) with check (true);

create policy "food_orders_auth" on public.food_orders for all to authenticated using (true) with check (true);
create policy "food_menu_read" on public.food_menu_items for select to authenticated using (true);
create policy "food_menu_admin" on public.food_menu_items for all to authenticated using (true) with check (true);

create policy "market_read" on public.market_products for select to authenticated using (active = true);
create policy "service_bookings_auth" on public.service_bookings for all to authenticated using (true) with check (true);
