-- فواتير PDF + بيانات البائع الضريبية
alter table public.delivery_orders
  add column if not exists invoice_number text,
  add column if not exists invoice_issued_at timestamptz,
  add column if not exists seller_name text default 'ERVENOW',
  add column if not exists seller_vat_number text;
