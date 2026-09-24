تقرير كاشير ERVENOW داخل بوابة التاجر
التاريخ: 2026-09-23

1) بوابة التاجر الرسمية
المسار: /merchant-preview
الملفات: ervenow-frontend/merchant-preview.html و public/merchant-preview.html
المحتوى: ervenow-frontend/assets/merchant-preview.js
الهيكل: ErvenowPortalFramework.PortalShell مع قائمة merchant في role-context.js
لم تُنشأ بوابة جديدة. الهيدر والقائمة والألوان بقيت كما هي.

2) هل يوجد POS سابق؟
نعم، داخل نفس البوابة فقط: قسم pos كان Coming Soon في renderPos().
عنصر القائمة كان موجودًا في آخر القائمة ومخفيًا لأن وحدة ervenow_pos معطّلة.
لا توجد صفحة POS ثانية داخل البوابة. لم يُحذف شيء.
examples/kabsar-pos-ervenow-push.js تكامل خارجي قديم وليس شاشة التاجر.

3) مسار الطلبات الحالي
قسم «الطلبات» في بوابة التاجر.
القراءة: GET /api/store/order-board و GET /api/store/merchant-dashboard
القبول: PATCH /api/order/:id/status إلى accepted
ثم: POST /api/order/:id/action بإجراء start_preparing ثم mark_ready
الحالة الوحيدة: delivery_status
المسار: جديد/قيد الانتظار → مقبول → قيد التجهيز → جاهز → الاستلام أو التوصيل
التنبيه الحي كان يحدّث اللوحة عبر socket order:patch دون جرس أو شريط.

4) مكان الإشعارات العامة
أعلى مساحة المحتوى في بوابة التاجر (#mpIncomingHost) لأنه يبقى ظاهرًا أيًا كان القسم المفتوح، بما فيه الكاشير.
الجرس الموجود في الهيدر يأخذ العداد.
عنصر «الطلبات» في القائمة الجانبية يأخذ نفس العداد.
لم يُبنَ نظام إشعارات ثانٍ.

5) الملفات التي عُدّلت
- ervenow-frontend/assets/merchant-preview.js و public/assets/merchant-preview.js
- ervenow-frontend/assets/merchant-pos.js و public/assets/merchant-pos.js
- ervenow-frontend/assets/merchant-preview.css و public/assets/merchant-preview.css
- ervenow-frontend/merchant-preview.html و public/merchant-preview.html
- role-context.js و configs/merchant.json و portal-sidebar.js و portal-platform-modules.js في النسختين
- apps/store/routes.js
- shared/services/merchantPosOrder.js
- shared/utils/merchantPosSettings.js
- shared/utils/ordersSchemaOptional.js
- tests/unit/merchantPos.test.js

6) الازدواج الذي عولج
قسم pos القديم صار شاشة الكاشير نفسها، بلا مسار جديد.
ظهور الكاشير صار بإعداد المتجر «استخدام كاشير ERVENOW»، لا بوحدة ervenow_pos العامة.
وحدة ervenow_pos بقيت معطّلة ولم تُفعَّل للجميع.
طلبات الكاشير وطلبات المنصة في جدول orders نفسه.
المصدر: data.order_source و series_source بقيمتي pos و ervenow.
تعطيل الكاشير لا يغيّر استقبال طلبات المنصة.
لم تُمس المحفظة ولا التسويات ولا نظام المندوب.

ما نُفّذ
عنصر «الكاشير POS» بين الطلبات والمنتجات، ويصير Active عند فتحه.
الشاشة داخل مساحة العمل: محلي / استلام / توصيل، فئات، بحث، بطاقات من كتالوج المتجر، طلب حالي مع زيادة ونقص وحذف، مجموع فرعي وضريبة 15٪ والمجموع، نقدي / شبكة / دفع إلكتروني، تعليق، إلغاء، إتمام مع فاتورة.
الأسعار تُعاد حسابها على الخادم من store_products. لا كتالوج مستقل.
الإعداد في «أكمل صفحتك». الافتراضي ON. عند OFF يختفي العنصر ويُرفض إنشاء طلب كاشير.
طلب ERVENOW الجديد: جرس مرة، عداد على الجرس وعلى «الطلبات»، وشريط فيه الرقم والنوع والقيمة و«عرض الطلب» و«قبول الطلب».
الشريط لا يمسح سلة الكاشير. القبول يستخدم الانتقال الحالي إلى accepted.
طلب الكاشير يُحفظ مصدره pos وبحالة مكتمل عند الصندوق، فلا يدخل طابور المندوب.
الضريبة 15٪ لأن محرك الطلبات في ERVENOW يحسبها هكذا، والرقم في المرجع البصري (6 من 40) يطابق 15٪ لا 1٪.
