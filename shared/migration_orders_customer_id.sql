-- إضافة customer_id/customer_phone للتوافق مع الأنظمة الحالية
alter table public.orders
add column if not exists customer_id uuid,
add column if not exists customer_phone text;
