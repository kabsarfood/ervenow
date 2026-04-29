-- إحداثيات المسار، المسافة الفعلية (طريق)، أجور التوصيل وعمولة المنصة
alter table public.delivery_orders
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists drop_lat double precision,
  add column if not exists drop_lng double precision,
  add column if not exists distance_km double precision,
  add column if not exists delivery_fee numeric(12, 2),
  add column if not exists platform_fee numeric(12, 2),
  add column if not exists order_total numeric(12, 2);
