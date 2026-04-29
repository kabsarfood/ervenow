-- ضريبة القيمة المضافة 15% على (قيمة الطلب + التوصيل)
-- نفّذ على Supabase بعد النسخ الاحتياطي.

alter table public.delivery_orders
  add column if not exists vat_amount numeric(12, 2) default 0,
  add column if not exists total_with_vat numeric(12, 2);

create table if not exists public.vat_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.delivery_orders (id) on delete set null,
  vat_amount numeric(12, 2),
  created_at timestamptz default now()
);

create index if not exists idx_vat_records_order on public.vat_records (order_id);

alter table public.vat_records enable row level security;

drop policy if exists "vat_records_select_auth" on public.vat_records;
create policy "vat_records_select_auth" on public.vat_records
  for select to authenticated using (true);

drop policy if exists "vat_records_insert_auth" on public.vat_records;
create policy "vat_records_insert_auth" on public.vat_records
  for insert to authenticated with check (true);
