-- تقييم العميل بعد تسليم طلب التوصيل
alter table public.delivery_orders
  add column if not exists rating integer,
  add column if not exists review text;
