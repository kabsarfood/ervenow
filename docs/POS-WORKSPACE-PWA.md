# كاشير ERVENOW — التقرير ثم التثبيت

التاريخ: 2026-09-24

## الوضع الرسمي

- الملف: ervenow-frontend/assets/merchant-pos.js داخل merchant-preview.js. النسخة المنشورة في public/assets.
- المسار: /merchant-preview#pos. لا pos-v2 ولا cashier-new.
- المنتجات والفئات: store_products وكتالوج المتجر نفسه عبر بوابة التاجر. لا كتالوج كاشير مستقل.
- محرك الطلب: POST /api/store/pos-orders ثم insertPosOrder في shared/services/merchantPosOrder.js. المصدر series_source=pos و data.order_source=pos. طلبات المنصة تبقى نفس جدول orders ومسار القبول الحالي.
- اللحظي: Socket.IO في shared/lib/trackingSocket.js على /socket.io/ مع بث order:patch لغرفة المتجر. لا polling كل ثانية.
- المطبخ وشاشة العميل: غير موجودين. لا مكوّن قديم يُعاد استخدامه.
- PWA سابقًا: لا manifest ولا service worker. أُضيفا الآن على نفس البوابة.
- /store الحالي صفحة العميل store.html وليست Workspace الموظف. لا عمود slug عام للمتجر، لذلك لم يُنشأ /store/{slug} حتى لا يصطدم بصفحة العميل.

## ما نُفّذ في هذه الجولة

- الخانات: 12 / 9 / 8 حسب الشاشة. الصور cover بارتفاع قصير. التمرير مستقل. أسفل الطلب ثابت.
- التنبيه من بوابة التاجر موجود من الجولة السابقة: جرس، شارة الطلبات، بانر، والسلة المحلية لا تُمسح. إيقاف الكاشير لا يوقف طلبات المنصة.
- كل طلب كاشير يحمل client_order_id ويُحفظ في idempotency_key عند توفر العمود، مع cashier_id و branch_id فارغين الآن داخل data. لا شاشة موظفين ولا OTP.
- IndexedDB ervenow-pos: نسخة الكتالوج الأخيرة وطابور pending_sync. عند انقطاع الشبكة يُحفظ البيع محليًا وتظهر حالة «بدون اتصال». عند العودة تُزامَن الطلبات بنفس المعرّف حتى لا تتكرر. فشل المزامنة يبقى في الطابور ويُعرض للكاشير.
- PWA: /merchant-pos.webmanifest و /merchant-pos-sw.js يُسجَّلان من صفحة البوابة، display standalone، وstart_url هو /merchant-preview#pos. الشعار ما زال أيقونة الموقع العامة لأن اسم وشعار المتجر يحتاجان manifest ديناميكي لاحقًا.
- تفعيل الجهاز: عند فتح الكاشير يُحفظ storeId في localStorage تحت ervenow_pos_device. هذا ليس جلسة جهاز موثوقة ولا يلغي OTP.

## لم يُبنَ

إدارة الكاشيرات، دخول واتساب، إبطال الجهاز، رابط slug للمتجر، Kitchen Display، Customer Display، وتغيير المحفظة أو المندوب.

## القياس

- 1440×900: 4 أعمدة، 12 خانة، لا تجاوز للصفحة.
- 1024×768: 3 مناطق، 3 أعمدة، 9 خانات، لوحة الطلب ثابتة.
- 768×1024: عمود مع درج، 9 خانات، لا تجاوز.
- 390×844: عمودان، 8 خانات، شريط السلة ظاهر.

الاختبار: tests/unit/merchantPos.test.js — 3 نجحت.
