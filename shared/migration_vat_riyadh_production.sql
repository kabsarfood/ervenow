-- التقارير والـ VAT بحسب التقويم الرياضي + فهرس فاتورة (اسم: idx_invoice_number_unique)
-- نفّذ في Supabase SQL Editor.

-- 1.1
alter table public.vat_records
  add column if not exists vat_date_riyadh date;

-- ترحيل اختياري: نقل من vat_date (UTC) عند عدم توفّر تاريخ الرياض
update public.vat_records
  set vat_date_riyadh = vat_date
  where vat_date_riyadh is null
    and vat_date is not null;

-- 1.2 — إن وُجد فهرس/قيد مماثل (مثل delivery_orders_invoice_number_key) فهذان يكرران القيد ؛ احذف أحد المكررات لاحقاً إن رغبت
create unique index if not exists idx_invoice_number_unique
  on public.delivery_orders (invoice_number)
  where invoice_number is not null;

-- 1.3
alter table public.vat_records
  add column if not exists subtotal numeric(12, 2);
