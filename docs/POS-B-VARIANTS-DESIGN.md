# تصميم كاشير B — نسخ قابلة للبيع

التاريخ: 2026-09-24
بدون تنفيذ وبدون Migration.

## قرار Variants

`variants jsonb` على المنتج الأب يصف الخيارات ولا يصف النسخة المباعة. المطلوب جدول تابع:

store_product_variants
- id uuid
- product_id → store_products
- store_id → stores
- sku text
- barcode text
- attributes jsonb  مثال: {"اللون":"أحمر","المقاس":"M"}
- price numeric null
- offer_price numeric null
- stock integer null
- active boolean default true
- sort_order int default 0
- created_at, updated_at

المنتج بلا نسخ يبقي sku و barcode و stock على store_products.
إذا وُجدت نسخ نشطة، البيع والباركود وSKU والمخزون يكون على النسخة. سعر النسخة إن كان فارغًا يُؤخذ من المنتج الأب ثم offer_price إن كان أقل.

## الطلبات

لا يوجد جدول order_items. أصناف الطلب تُنسخ داخل orders.breakdown.items و orders.data.items وقت الإنشاء.
طلب الكاشير يحفظ اليوم: product_id, name, qty, unit_price, line_total.
تعديل المنتج لاحقًا لا يعيد كتابة هذه النسخة، لذلك الفاتورة القديمة تبقى.

لا ننشئ جدول أصناف جديد. نوسّع عنصر النسخة الموجود بهذه الحقول:
product_id
variant_id
product_name_snapshot
variant_snapshot
sku_snapshot
barcode_snapshot
unit_price
quantity

variant_id مرجع فقط. نص الفاتورة هو اللقطة. حذف النسخة أو تغيير لونها لاحقًا لا يغيّر الطلب القديم.

ملاحظة تنفيذ لاحقة: preparePosTicket يدمج الكمية حسب product_id فقط. مع النسخ يجب أن يكون المفتاح product_id + variant_id حتى لا تختلط أحمر/M مع أحمر/L.

## SKU و Barcode

يبقيان text حتى لا تسقط الأصفار الأولى.
قبل الحفظ: قص الطرفين، وإزالة المسافات الداخلية من الباركود، وتوحيد حالة SKU للمقارنة.
فهرس فريد جزئي لكل متجر على القيم غير الفارغة، على store_products وعلى store_product_variants.
فهرس واحد لا يغطي الجدولين معًا، لذلك الحفظ يرفض الرمز إذا كان مستخدمًا في الجدول الآخر لنفس المتجر.

## إعداد الكاشير لاحقًا

على stores وليس الآن:
pos_enabled boolean default true
pos_mode text default 'A' check (pos_mode in ('A','B','C'))
التطبيق يرفض تفعيل C. ملف merchant-pos-flags.json يبقى حتى استيراده.

## أثر A

لا صفوف نسخ، والحقول الجديدة فارغة. شاشة A لا تطلبها ولا يتغير سلوكها.
