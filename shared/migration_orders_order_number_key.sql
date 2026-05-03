-- فهرس فريد على رقم الطلب (منع التكرار على مستوى القاعدة)
-- إن وُجد سابقاً idx_orders_order_number_unique بنفس الغرض، يكفي أحدهما؛ هذا الاسم كما في المواصفات.

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_key
ON public.orders (order_number);
