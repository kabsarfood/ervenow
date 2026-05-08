# Legacy inventory — جرد الأنظمة القديمة (أدلة من المستودع)

تاريخ الجرد: مرتبط بمشروع ERVENOW الحالي. **لا يُستخدم كإذن بالحذف** دون مراجعة قاعدة بيانات الإنتاج.

---

## `delivery_orders`

| المصدر | الدليل |
|--------|--------|
| **JavaScript** | لا يوجد `from("delivery_orders")` أو `'delivery_orders'` في ملفات `.js` (بحث شامل). |
| **SQL** | `shared/schema.sql` + عدة `migration_*.sql` (فواتير، VAT، كبسار، إلخ). |

**الخلاصة:** الجدول **وثيق/تاريخي** في مخطط Supabase؛ **مسار التشغيل الحالي** يكتب في `orders` فقط (`insertDeliveryOrderWithRetry` → `from("orders")`).

**الإجراء الموصى به:** الإبقاء على الجدول في الإنتاج حتى تُثبت عدم وجود تكاملات خارجية (BI، نسخ قديمة). توثيق «غير مستخدم من Node».

---

## `food_orders`

| المصدر | الدليل |
|--------|--------|
| **JavaScript** | `apps/food/routes.js` — `GET/POST /api/food/orders` يقرأ ويكتب `food_orders`. |

**الخلاصة:** **نشط** — ليس legacy من ناحية API.

**ملاحظة:** عمود `delivery_order_id` في `food_orders` (في `schema.sql` يشير تعليقياً إلى `delivery_orders`)؛ في التطبيق يُحدَّث بـ **`delRow.id`** القادم من **`insertDeliveryOrderWithRetry` على `orders`** — أي أن القيمة فعلياً **معرّف طلب في `orders`** (تسمية عمود قديمة).

---

## `orders.delivery_order_id` (مالي)

| المصدر | الدليل |
|--------|--------|
| **JavaScript** | `apps/finance/hooks.js` — `onDeliveryDelivered` يبحث عن صف `orders` بـ `delivery_order_id` كمسار بديل. |
| **JavaScript** | `apps/finance/routes.js` — يسمح بتمرير `delivery_order_id` عند إنشاء طلب مالي. |

**الخلاصة:** حقل **توافق/ربط قديم** مع نموذج «طلب مالي» منفصل عن صف التوصيل الموحّد.

---

## `wallet-server.js` (`apps/finance/wallet-server.js`)

| المصدر | الدليل |
|--------|--------|
| **HTTP** | مسارات `GET /api/wallet/:userId` و`POST /api/wallet/withdraw` **بدون JWT**. |

**الخلاصة:** **خطر أمني** إن وُضع على الإنترنت. يُعامل كـ **legacy / داخلي** حتى إزالته أو تأمينه.

---

## ملخص القرار لمرحلة التثبيت

1. **`orders`** = مصدر حقيقة التوصيل في Node.  
2. **لا حذف** `delivery_orders` / `food_orders` في هذه المرحلة.  
3. **توثيق** فقط + خطة لاحقة لإما أرشفة `delivery_orders` أو دمج بيانات.
