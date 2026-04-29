-- قيد تفرد على order_number (يُنفّذ مرة في Supabase SQL).
-- إن وُجدت قيم order_number مكرّرة: صححها أولاً ثم نفّذ.
alter table public.delivery_orders
  add constraint unique_order_number unique (order_number);
