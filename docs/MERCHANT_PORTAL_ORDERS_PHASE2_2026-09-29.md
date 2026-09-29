# مرحلة 2 — #orders كواجهة تشغيل الطلبات داخل PortalShell

تاريخ: 2026-09-29
النطاق: `/merchant-dashboard#orders` داخل PortalShell. لم يُحذف `/order-board` ولم يُضف redirect.

## Matrix الوظائف

الميزة | #orders | order-board | القرار
عدادات الحالات (6) | بعد النقل | نعم | نُقل إلى #orders
طلبات جديدة / مقبول / تجهيز / جاهز / مع المندوب / مُسلّم | نعم | نعم | مشترك عبر status_counts
قيد التنفيذ (نشط بدون المُسلّم) | نعم (فلتر active) | نعم (filter=null) | مكافئ
مكتملة (مُسلّم) | نعم (عداد delivered) | نعم | مكافئ
ملغاة | لا تُعرض | لا تُعرض | لم نضف قائمة إلغاء
بحث رقم/جوال/اسم | نعم | لا | بقي في #orders (أوسع)
فلترة التاريخ | نعم (?date=) | لا | بقي في #orders
تفاصيل + Modal | نعم (لوحة البوابة) | نعم (ob modal) | نُقل المحتوى لا الإطار البصري
قبول / تجهيز / جاهز | نعم (نفس PATCH/action) | نعم | نفس العقود
تسليم/إكمال من التاجر | لا API في nextAction | لا | لم يُضف
رفض الطلب | لا | لا | لم يُضف
طباعة حرارية 80 | نعم printThermal80 | نعم (غالباً عند جاهز) | متاحة في #orders لكل حالة غير ملغاة
بيانات العميل | نعم | نعم | مكافئ
بيانات المندوب | نعم (نفس الحقول) | نعم | مكافئ
الخريطة Leaflet | lazy عند فتح التفاصيل | lazy عبر نفس الـ helper | نُقل
تتبع | رابط /track عند ready/picked_up | عند picked_up/delivering (+ready في البوابة) | نفس المسار
Socket order:patch|new|cancelled | اتصال واحد في PortalShell | اتصال في صفحة order-board فقط | لا تكرار داخل البوابة
حالة الدفع + الحالة المالية | نعم | نعم | مكافئ
طريقة الاستلام | نعم إن وُجدت في البيانات | غير بارزة في البطاقة | عُرضت في #orders من الحقول الموجودة
ملاحظات / أصناف / إجمالي+عمولة+صافي | نعم | نعم | مكافئ
ضريبة/رسوم سطر مستقل | لا في المصدرين | لا | لم يُضف

ما كان ناقصاً في #orders ونُقل: عدادات status_counts، بطاقات غنية (عميل، أصناف، مالية)، Leaflet بدل iframe، بيانات المندوب غير المعيَّن، طباعة حرارية من القائمة، أزرار المندوب/التتبع.

## الملفات المعدلة

- public/assets/merchant-order-ops.js (جديد)
- public/assets/merchant-preview.js
- public/assets/merchant-preview.css
- public/assets/order-board.js (خريطة عبر الـ helper)
- public/merchant-dashboard.html
- public/merchant-preview.html
- public/order-board.html
- نسخ مقابلة تحت ervenow-frontend/

## Orders data flow

المصدر: GET `/api/store/order-board` (مع `?date=` إن اختير يوم).
الكاش: `state.board` مشترك بين Home و Orders.
Home لا يفتح كتالوج المنتجات. المنتجات/الكاشير/المحفظة/المصروفات/التقييمات تُحمَّل فقط عند أقسامها.

## Socket / Polling

- اتصال Socket واحد في PortalShell (يُنشأ مرة، لا يُعاد عند التنقل بين الأقسام).
- Interval واحد: 45 ثانية، يعمل فقط على Home و Orders (يُوقف عند Wallet وغيرها، دون listeners إضافية).
- لا interval جديد عند فتح #orders.
- Socket يبقى المصدر الفوري؛ الـ poll احتياطي.

## الخريطة والطباعة

- Leaflet يُحمَّل عند فتح تفاصيل طلب فيه إحداثيات، ويُدمَّر عند الإغلاق (instance واحد).
- الطباعة: `ErvenowMerchantOrderWorkflow.printThermal80` على بيانات الطلب الحالية. لا endpoint جديد.

## API

لم يتغير عقد ولا RLS ولا schema. نفس PATCH `/api/order/:id/status` و POST `/api/order/:id/action`.

## اختبار الشبكة (تقدير خمول دقيقة على #orders)

بعد الإقلاع، بدون تفاعل:
- `/api/store/order-board`: تقريباً 2 (تحميل أول عند فتح القسم + poll عند ~45ث).
- `/api/store/merchant-dashboard`: 0 أثناء الخمول (مرة واحدة عند boot للبوابة فقط).
- لا منتجات/كاشير/سحب/مصروف/تقييمات على #orders.
- Socket: اتصال واحد.

## ما بقي في /order-board

- إطار store-shell (عنوان، رابط المتجر العام، زر تحديث يدوي، ألوان ob-*).
- عدادات بتسميات إنجليزية في التلميح.
- الطباعة من البطاقة مرتبطة أكثر بحالة «جاهز» في تلك الصفحة.
- لا بحث ولا تاريخ هناك.
الصفحة لم تُحذف ولم يُعمل redirect.

## القرار

نعم: `/merchant-dashboard#orders` أصبح مكافئاً وظيفياً لتشغيل الطلبات في `/order-board` داخل البوابة (نفس البيانات والإجراءات والخريطة والطباعة والمندوب)، مع بحث وتاريخ إضافيين كانت في البوابة مسبقاً. لم يُعتمد redirect بعد.
