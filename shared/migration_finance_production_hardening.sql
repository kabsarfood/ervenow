-- تفريد الفواتير، تفريد VAT لكل طلب، أعمدة إضافية، رابط الفاتورة
-- نفّذ في Supabase SQL Editor. إن وُجدت صفوف مكررة لـ order_id في vat_records أزلها قبل القيد.

-- 1.1 تفريد رقم الفاتورة (أكثر من NULL مسموح كقيم ليست مُصدَّرة بعد)
create unique index if not exists delivery_orders_invoice_number_key
  on public.delivery_orders (invoice_number)
  where invoice_number is not null;

-- 1.2 منع تكرار سجل VAT لنفس الطلب
create unique index if not exists vat_records_order_unique
  on public.vat_records (order_id)
  where order_id is not null;

-- 1.3
alter table public.vat_records
  add column if not exists subtotal numeric(12, 2),
  add column if not exists vat_date date default (current_date);

-- 1.4
alter table public.delivery_orders
  add column if not exists invoice_url text;

-- RLS: السماح بتحديث vat عند الـ upsert (عميل مصادق)
drop policy if exists "vat_records_update_auth" on public.vat_records;
create policy "vat_records_update_auth" on public.vat_records
  for update to authenticated using (true) with check (true);
