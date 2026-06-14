-- إصلاح طلبات نقل المركبات التي حُفظت بمضاعفة order_total = delivery_fee (قبل إصلاح unifiedDeliveryCreate)
UPDATE orders o
SET
  order_total = 0,
  vat_amount = round(COALESCE(o.delivery_fee, 0) * 0.15::numeric, 2),
  total_with_vat = round(COALESCE(o.delivery_fee, 0) * 1.15::numeric, 2),
  total_amount = round(COALESCE(o.delivery_fee, 0) * 1.15::numeric, 2)
WHERE COALESCE(o.delivery_fee, 0) > 0
  AND abs(COALESCE(o.order_total, 0) - COALESCE(o.delivery_fee, 0)) < 0.02
  AND (
    lower(COALESCE(o.data->>'service_type', '')) IN ('car_transport', 'pickup_truck', 'vehicle_transfer')
    OR lower(COALESCE(o.service_type, '')) IN ('car_transport', 'pickup_truck', 'vehicle_transfer')
  )
  AND abs(
    COALESCE(o.vat_amount, 0)
    - round((COALESCE(o.order_total, 0) + COALESCE(o.delivery_fee, 0)) * 0.15::numeric, 2)
  ) < 0.05;
