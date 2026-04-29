-- عمود رقم عرض (مثل ED-26-001) — نفّذ مرة في Supabase SQL Editor إن كان الجدول منشأاً قبل إضافته
alter table public.delivery_orders add column if not exists order_number text;
