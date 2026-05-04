-- تكامل مالي لجدول orders: تعبئة total_with_vat + قيد يمنع صفوفاً «فارغة» (مع استثناء الملغاة)
-- نفّذ بعد migration_orders_unify_delivery.sql

-- 1) تعبئة vat_amount الناقص (15% من السلعة + التوصيل)
UPDATE public.orders o
SET vat_amount = round((COALESCE(o.order_total, 0) + COALESCE(o.delivery_fee, 0)) * 0.15::numeric, 2)
WHERE o.vat_amount IS NULL
  AND (COALESCE(o.order_total, 0) + COALESCE(o.delivery_fee, 0)) > 0;

-- 2) تعبئة total_with_vat الناقص أو الصفر عندما يوجد مكوّن موجب
UPDATE public.orders o
SET total_with_vat = round(
  (COALESCE(o.order_total, 0) + COALESCE(o.delivery_fee, 0) + COALESCE(o.vat_amount, 0))::numeric,
  2
)
WHERE o.total_with_vat IS NULL
   OR (
     COALESCE(o.total_with_vat, 0) = 0
     AND (COALESCE(o.order_total, 0) + COALESCE(o.delivery_fee, 0) + COALESCE(o.vat_amount, 0)) > 0
   );

-- 3) قيد: طلب غير ملغى يجب ألا يكون المبلغ كله صفراً (مع استثناء الملغاة)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS total_not_zero;

ALTER TABLE public.orders
ADD CONSTRAINT total_not_zero CHECK (
  LOWER(COALESCE(delivery_status, '')) IN ('cancelled_by_customer', 'cancelled')
  OR LOWER(COALESCE(status, '')) IN ('cancelled')
  OR COALESCE(total_with_vat, 0) > 0
  OR COALESCE(order_total, 0) > 0
  OR COALESCE(delivery_fee, 0) > 0
) NOT VALID;

-- بعد التأكد من عدم وجود صفوف مخالفة:
-- ALTER TABLE public.orders VALIDATE CONSTRAINT total_not_zero;
