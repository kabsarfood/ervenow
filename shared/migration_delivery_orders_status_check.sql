-- إن كان إدراج طلب التوصيل يفشل بسبب delivery_orders_status_check (مثلاً القاعدة تسمح بـ pending وليس new):
-- نفّذ هذا الملف مرة واحدة في SQL Editor في Supabase.

alter table public.delivery_orders drop constraint if exists delivery_orders_status_check;

alter table public.delivery_orders
  add constraint delivery_orders_status_check
  check (
    status in (
      'new',
      'pending',
      'accepted',
      'delivering',
      'delivered',
      'cancelled'
    )
  );

-- (اختياري) إن أردت توحيد السجلات القديمة: new → pending
-- update public.delivery_orders set status = 'pending', updated_at = now() where status = 'new';
