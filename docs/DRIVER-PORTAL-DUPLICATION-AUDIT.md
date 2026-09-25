# تدقيق ازدواجية بوابة المندوب

التاريخ: 2026-09-25
النطاق: حصر فقط. لم يُحذف شيء ولم يُغيَّر Redirect ولم يُدمج كود.

`#dashboard` و`#ready` أقسام داخل `/driver-preview`. ليسا صفحات مستقلة.

## الجدول

المسار | الملف | الغرض | الحالة | مصدر الطلبات | APIs | دخول ودور | من يشير إليه | تداخل | الفريد
---|---|---|---|---|---|---|---|---|---
`/driver-preview` | `server.js` يخدم `public/driver-preview.html` من `ervenow-frontend/driver-preview.html` + `assets/driver-preview.js` | Shell بوابة المندوب | مستخدم. مسار ما بعد الدخول | `GET /api/driver/orders` | me، orders، accept، start-delivery، complete-order، update-location، wallet، earnings، rating، order status | نعم. driver أو admin. غير ذلك يُرفض. النقل يُحوَّل إلى transport-preview | login، portalLaunch، role-routing، الضيف، الشكاوى، واتساب التوصيل الداخلي، 301 من `/driver` و`/driver-dashboard` | يغطي الدورة ما عدا خريطة الوصول | الرئيسية، الجاهزة، النشطة، المكتملة، الأرباح، المحفظة، التقييم، الإشعارات، الإعدادات
`/driver-preview#dashboard` | نفس الملف | قسم الرئيسية | قسم داخل البوابة | نفس orders | نفس ما سبق | نفس البوابة | التبويب الافتراضي | لا | نظرة اليوم والاختصارات
`/driver-preview#ready` | نفس الملف | الطلبات الجاهزة | قسم | `orders.ready` و`legacy_open` من `/api/driver/orders` | accept | نفس البوابة | تبويب القائمة | يقابل قائمة `/orders` المتاحة | طابور الجاهز من المتجر
`/driver-app` | `server.js` يخدم `driver-app.html` | تطبيق تتبع ثانٍ | مستخدم تشغيلياً وليس المسار بعد الدخول | `GET /api/driver/orders` و`GET /api/delivery/orders/:id` | start-delivery، ping-arrival، complete-order، update-location، me | الجلسة عبر PlatformAPI. الواجهة تفترض مندوبًا | تذييل driver-preview، driver-nav، قائمة الضيف للمندوب، track.html، واتساب المندوب `driver-app.html` | قائمة الطلبات النشطة مكررة | الخريطة، «وصلت للعنوان» عبر ping-arrival
`/driver-app#orders` | نفس الملف | تبويب قائمة الطلبات النشطة | قسم داخل التطبيق الثاني | الطلبات المسندة من `/api/driver/orders` | نفس driver-app | نفس التطبيق | التبويب الافتراضي | يقابل `#active` في preview | اختيار الطلب ثم فتح التتبع
`/driver-app#track` | نفس الملف | الخريطة والحالة | قسم | الطلب المختار | start، ping-arrival، complete، update-location | نفس التطبيق | iframe داخل preview إن فُتح `#live-track`، وtrack.html | التتبع غير مبني داخل preview | الخريطة وزر الوصول
`/orders` | `server.js` يخدم `orders.html` | شاشة تشغيل قديمة لطلبات المنصة للمندوب | Legacy ما زال مربوطًا من القائمة | `GET /api/order/orders` لا `/api/driver/orders` | accept، start-delivery، complete-order، update-location، me | توكن إلزامي. العميل يُحوَّل إلى `/my-orders`. غير driver/admin يُخرج | driver-nav «طلبات المنصة»، قائمة الضيف للمندوب «طلباتي»، زر الرئيسية إذا كان الدور driver | قبول/بدء/إكمال موجودان في preview | لا خريطة وصول ولا محفظة. مصدر القائمة أوسع وأقدم

## مقارنة preview مع driver-app

الوظيفة | `/driver-preview` | `/driver-app`
---|---|---
الرئيسية | نعم `#dashboard` | لا
الطلبات المتاحة | نعم `#ready` من طابور المندوب | لا. القائمة للمسند فقط
الطلبات المقبولة / الحالية | نعم `#active` | نعم `#orders`
التتبع | ليس شاشة خاصة. `#live-track` يضع iframe إلى `/driver-app?order=#track`. عنصر live-track موجود في `driver.json` وغير موجود في عناصر `role-context.js`. الوصول الفعلي من تذييل «التتبع الحي» الذي يغادر البوابة | نعم خريطة Leaflet
تغيير الحالة | قبول، بدء، إكمال، وتحديث حالة الطلب | بدء، وصلت، إكمال
الأرباح | نعم | لا
المحفظة | نعم | لا
الحساب | الإعدادات وتبديل الحساب | لا
الإشعارات | نعم | لا
الوصول للعنوان | لا يستدعي `ping-arrival` | نعم `POST /api/driver/ping-arrival/:id`

## `/orders`

ليست صفحة عميل. العميل الذي يفتحها يُرسل إلى `/my-orders`.
ليست صفحة عامة. بلا توكن تظهر «الرجاء الدخول كشريك توصيل».
هي شاشة تشغيل قديمة للمندوب: المتاحة والمسندة، قبول وبدء وإكمال، وإرسال موقع.
مصدرها `GET /api/order/orders`، بينما البوابة الرسمية تقرأ `GET /api/driver/orders` (جاهز، مفتوح قديم، مسند، مكتمل). لذلك القائمتان ليستا نفس الاستعلام.

## مراجع الروابط

الأعداد تشمل النسخة المصدر و`public/` عندما تكون نسخة منشورة من نفس الملف.

`driver-preview` — مراجع تشغيلية: `server.js` (المسار و301 من `/driver` و`/driver-dashboard`)، `portalLaunch.js`، `role-routing.js`، `guest-shell.js`، `driver-nav.js`، `account-destinations.js`، `platform-access.js`، `blocked-complaints.html`، `internalDeliveryNotify.js`، `data/portal-launch.json`، اختبارات الدخول. الباقي توثيق و`data/admin-readiness.json`.

`driver-app` — مراجع تشغيلية: `server.js`، `driver-app.html`، `driver-preview.js` (iframe)، `role-context.js` تذييل «التتبع الحي»، `driver-nav.js`، `guest-shell.js`، `track.html`، `orders.html`، `driver.html`، `whatsappService.js` (رابط `driver-app.html`)، `bannerTargets.js`، `bannerPlacements.js`، `adminRoleTaxonomy.js` (يصنّفه قديماً). تكرار كبير داخل `driver-shell.css` و`driver-app.html` هو أسماء CSS لا روابط تنقّل.

`/orders` كصفحة: `server.js`، `orders.html`، `driver-nav.js`، `guest-shell.js` للمندوب فقط، `index.html` إذا كان الدور driver، `my-orders.html` يحوّل بعض الحالات إلى `/orders`. أغلب نتائج البحث الأخرى هي مسارات API مثل `/api/driver/orders` و`/api/order/orders` وليست هذه الصفحة.

## التصنيف

الشاشة | التصنيف | السبب
---|---|---
`/driver-preview` وأقسامه `#dashboard` `#ready` `#active` `#completed` `#earnings` `#wallet` `#rating` `#notifications` `#settings` | KEEP | البوابة الرسمية بعد الدخول. التبويبات ليست ازدواجية
`/driver-app` و`#orders` و`#track` | MERGE | الوظيفة الفريدة هي الخريطة و`ping-arrival`. القائمة نفسها مكررة. بعد نقل التتبع إلى القسم الداخلي يصبح المرشح REDIRECT لا الحذف الآن
`/orders` | LEGACY | شاشة مندوب قديمة بمصدر بيانات مختلف. العميل لا يبقى عليها. المرشح لاحقاً REDIRECT إلى `#ready` بعد التأكد أن طابور `/api/driver/orders` يغطي ما تعرضه `/api/order/orders`
`/driver` و`/driver-dashboard` | REDIRECT | 301 موجود أصلاً إلى `/driver-preview`. لا يُمس في هذه الجولة

UNKNOWN: لا شيء من المسارات الثلاثة. الفرق المتبقي المعروف هو مصدر قائمة `/orders` مقابل طابور المندوب، ويُحسم عند الدمج لا الآن.

## المسار الرسمي المقترح — بدون تنفيذ

بوابة واحدة: `/driver-preview`

الطلبات المتاحة `#ready` → قبول → الطلب الحالي `#active` → التتبع داخل نفس البوابة (نقل الخريطة و«وصلت» من `driver-app`) → تسليم → السجل والأرباح `#completed` و`#earnings`.

`driver-app` بعد النقل يصبح تحويلاً إلى قسم التتبع، لا تطبيقاً ثانياً.
`/orders` بعد مطابقة القائمة يصبح تحويلاً إلى `#ready`.
لا تُحذف الصفحات قبل ذلك.
