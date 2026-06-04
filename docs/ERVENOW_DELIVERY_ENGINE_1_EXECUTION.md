# ERVENOW DELIVERY ENGINE 1.0 — تقرير التنفيذ

## Feature flags (افتراضي: معطّل)

```env
DELIVERY_ENGINE_POLICY=true
DELIVERY_ENGINE_PRECART=true
DELIVERY_ENGINE_CHECKOUT=true
DELIVERY_ENGINE_STORE_OTP=true
```

| Flag | الموجة | السلوك عند التعطيل |
|------|--------|---------------------|
| `DELIVERY_ENGINE_POLICY` | 1 | لا quote ولا `delivery_engine` في المتجر العام |
| `DELIVERY_ENGINE_PRECART` | 2 | إضافة للسلة كالسابق (بدون modal) |
| `DELIVERY_ENGINE_CHECKOUT` | 3 | GPS في `cart.html` + `km×2.3` في checkout |
| `DELIVERY_ENGINE_STORE_OTP` | 4 | لا OTP ولا `confirm-receipt` |

## Migration

`shared/migration_delivery_engine_1.sql`

- `stores`: `delivery_policy`, `free_delivery_policy`, `free_delivery_min_order`, `free_delivery_radius_km`, `delivery_fee_per_km`
- `store_products.includes_delivery`
- `order_receipt_otps`

## APIs

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/api/store/public/:id/delivery-quote` | Quote موحد |
| POST | `/api/store/resolve-maps-link` | استخراج lat/lng من رابط خرائط |
| GET | `/api/store/delivery-engine/flags` | حالة الأعلام للواجهة |
| PATCH | `/api/store/delivery-policy` | تاجر — سياسة المتجر |
| POST | `/api/store/orders/:orderId/delivery-otp` | تاجر — إنشاء OTP تسليم |
| POST | `/api/order/:id/confirm-receipt` | عميل — تأكيد OTP → `delivered` + Settlement الحالي |

## Before / After

### Before

- موقع GPS وأجرة التوصيل داخل صفحة السلة (`#storeDeliveryCard`).
- `checkout` يطلب `customer_lat/lng` لكل طلب متجر.
- رسوم ثابتة تقريباً: `km × 2.3`.
- لا سياسات توصيل على مستوى المتجر.
- لا تمييز «شامل التوصيل» على المنتج.

### After (عند تفعيل الأعلام الأربعة)

1. **قبل السلة:** استلام / توصيل → موقع (خرائط أو GPS) → quote → `item.data` مع `delivery_snapshot_version: 1`.
2. **السلة:** عرض فقط (نوع التوصيل، الموقع، المسافة، ETA، الرسوم) — بدون GPS في السلة.
3. **Checkout:** يقرأ الـ snapshot؛ pickup بدون إحداثيات؛ `ervenow_delivery` يفعّل dispatch؛ `store_delivery` لا dispatch.
4. **OTP:** متجر يولّد رمزاً؛ عميل يؤكد → `delivered` عبر `runDeliveredFinancialSettlement` (بدون تعديل Ledger).

## ملفات رئيسية

- `shared/services/deliveryPolicyEngine.js`
- `shared/services/deliveryQuoteService.js`
- `shared/utils/checkoutDeliveryEngine.js`
- `shared/utils/cartDeliverySnapshot.js`
- `apps/store/deliveryEngineRoutes.js`
- `public/assets/pre-cart-delivery.js`
- `public/assets/cart.js` (عرض snapshot + رسوم)
- `apps/checkout/service.js`

## ما لم يُمس

- Ledger / Revenue Flow / Financial Hardening
- قواعد Unified Cart (متجر واحد)
- عمولة 7% + VAT 15% عبر `computeErvCartBreakdown`

## Smoke test (يدوي)

1. نفّذ migration على Supabase.
2. فعّل الأعلام الأربعة وأعد تشغيل الخادم.
3. متجر: `PATCH /api/store/delivery-policy` → `store_plus_ervenow`.
4. `store.html`: أضف منتجاً → modal → quote → سلة تعرض التوصيل.
5. `cart.html`: checkout بدون بطاقة GPS.
6. طلب `store_delivery`: تاجر OTP → عميل `POST /api/order/:id/confirm-receipt`.

## اختبار تلقائي

```bash
node --test tests/unit/deliveryPolicyEngine.test.js
```

## توافق

| نظام | الحالة |
|------|--------|
| Unified Cart | متوافق — نفس `store_id` + snapshot |
| ERVENOW PAY | متوافق — `financial_intent` + grand total من snapshot |
| Driver System | `ervenow_delivery` فقط يُرسل dispatch |
| Store Dashboard | سياسة عبر API؛ OTP عبر `delivery-otp` |

## responsive

- Modal pre-cart: `min-height: 48px`، حقول `font-size: 16px`، `safe-area`، يعمل 320px / 768px / 1280px.
