-- ربط تطبيقات خارجية (مثل Kabsar POS) بمرجع الطلب
alter table public.delivery_orders
  add column if not exists external_order_id text,
  add column if not exists series_source text;

drop index if exists public.idx_delivery_external_order;

create unique index if not exists idx_ext_order_unique
  on public.delivery_orders (external_order_id)
  where external_order_id is not null;
