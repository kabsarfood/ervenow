# تدقيق أخطاء PostgreSQL — ERVENOW / Supabase

التاريخ: 2026-09-27
النطاق: تشخيص فقط. لم يُنفَّذ إصلاح، ولا ALTER، ولا migration، ولا حذف index، ولا تعديل RLS، ولا تغيير إعدادات Supabase، ولا deploy.

## ماذا تقول الأرقام

آخر 24 ساعة كما نُقلت من لوحة Supabase:

| المؤشر | القيمة |
|---|---:|
| Total Requests | 30,754 |
| Success Rate | 65% |
| API Gateway Requests | 25,197 |
| API Gateway Errors | 757 |
| PostgreSQL Requests | 4,809 |
| PostgreSQL Errors | 4,687 |
| CPU | نحو 6% |
| RAM | نحو 36% |
| Disk | نحو 3% |
| تنبيه | Disk IO budget is being consumed |

حسابات لا نفترض أنها تعريف اللوحة، لكنها تقيس الشكل:

- أخطاء PostgreSQL / طلبات PostgreSQL = 4,687 / 4,809 = **97.5%**.
- أخطاء API Gateway / طلباتها = 757 / 25,197 = **3.0%**.
- 4,687 + 757 = 5,444. هذا **لا يساوي** 35% من 30,754 (نحو 10,764) الذي يلزم لنسبة نجاح 65% إن كانت النسبة على المجموع كله. إذن إما أن النسبة تشمل خدمات لم تُنقل (Auth / Storage / Realtime) أو أن تعريف «خطأ» يختلف بين البطاقات.
- طلبات PostgreSQL (4,809) أصغر بكثير من طلبات البوابة (25,197). الاستعلامات الناجحة عبر PostgREST تُحتسب غالبًا تحت API Gateway. سلة PostgreSQL هنا سلة يغلب عليها الفشل، وليست عدّاد كل SQL.

الحكم التشخيصي من الشكل وحده: هناك مسار يولّد خطأ Postgres ثم يكمل بنجاح HTTP. البوابة تبقى قرب 97% نجاح، بينما سجل Postgres يمتلئ بأخطاء 42703. هذا يطابق نمط «جرّب العمود الناقص، إن فشل فارجع إلى عمود موجود».

تنبيه Disk IO مع CPU 6% متوافق مع رصيد IOPS على باقة صغيرة، لا مع اختناق معالج. المسح المتكرر لجدول `orders` من لوحة الإدارة يستهلك هذا الرصيد حتى لو لم يكن هو مصدر الـ 4,687 خطأ.

مقارنة بتشخيص 2026-09-26 (`docs/supabase-request-storm-diagnosis-2026-09-26.md`): البوابة كانت 40,200 طلبًا و 744 خطأ. اليوم 25,197 و 757 خطأ. حجم البوابة نزل، وعدد أخطائها لم ينزل. هذا يعني أن تباطؤ الاستطلاع خفّف النجاحات، وبقي تيار أخطاء ثابت تقريبًا (نحو 750 في اليوم على البوابة) بالإضافة إلى سلة Postgres الجديدة شبه الفاشلة بالكامل.

## ما الذي يُخدَم فعلًا

- خادم Express يقدّم `public/` (`server/server.js`).
- `public/admin-dashboard.html` صفحة مستقلة. لا تستورد `public/admin/modules/`. مؤقتاتها: إحصاءات كل **30 ثانية**، مالية كل **15 ثانية**، بلا إيقاف عند `document.hidden`.
- `public/admin/modules/shared.js` يضبط 120 ثانية مع إيقاف عند إخفاء التبويب، لكنه **ليس** الصفحة المفتوحة.
- `ervenow-frontend/` نسخة Vercel وقديمة عن `public/` في حلقات البوابات: استطلاع خدمة كل **8 ثوانٍ** وحضور موقع كل **15 ثانية** عبر `PATCH /api/services/me/location`، بلا نداء `/me/presence`. إن كان المتصفح يحمّل هذه النسخة غير المتزامنة، نبضة `last_seen_at` لا تخرج من الواجهة، ويبقى خطأ العمود من مسارات الخادم (قائمة المناديب والإدارة).

## A) أعلى 10 مصادر محتملة لأخطاء PostgreSQL

التقدير لـ 24 ساعة يفترض بقاء الصفحة أو العامل ظاهرًا/شغّالًا طوال المدة. إن كان التبويب مفتوحًا جزءًا من اليوم، اضرب في نسبة الوقت.

### 1) قائمة المناديب في لوحة الإدارة — خطأ مؤكد من الكود

- الملف: `apps/admin/routes.js` الدالة `attachUserIdsToDrivers`، المسار `GET /api/admin/drivers`
- الواجهة: `refreshLiveDashboard` → `refreshLiveDriversAndMap` داخل `public/admin-dashboard.html`
- الاستعلام الأول: `users.select("id, phone, last_seen_at").in("phone", phones)`
- عند فشل الرسالة إذا احتوت `last_seen_at`: إعادة `select("id, phone")` ثم HTTP 200
- المعدّل: كل **30 ثانية** ما دام تبويب الإدارة مفتوحًا، حتى في الخلفية (لا فحص `document.hidden` على هذا المؤقت). كاش الخادم 90 ثانية يغطي `/stats` فقط، ولا يغطي `/drivers`
- retry: نعم، مرة واحدة بعد الخطأ. الخطأ الأول يصل إلى Postgres في كل دورة
- تقدير 24 ساعة لتبويب إدارة واحد: **2,880 خطأ** `42703`، زائد 2,880 قراءة ناجحة بعد التراجع
- إن كان Socket.IO منقطعًا: احتياط كل **10 ثوانٍ** يستدعي نفس `refreshLiveDriversAndMap`. تبويب واحد طوال اليوم = **8,640** خطأ. الرقم المرصود 4,687 أصغر من ذلك، فإما السوكيت متصل أغلب الوقت، أو التبويب لم يبقَ مفتوحًا 24 ساعة متصلة

### 2) نبضة حضور مزود الخدمة / النقل — خطأ مؤكد من الكود إن وصلت النبضة

- الملف: `apps/services/routes.js` الدالة على `POST /api/services/me/presence`
- الواجهة الحية في `public/assets/portal-provider-location.js`: `sendPresence` كل **75 ثانية** طالما التبويب ظاهر والموقع جاهز
- من يستدعيها: `public/assets/service-preview.js` و `public/assets/transport-preview.js` عبر `startPresenceLoop` مرة عند فتح البوابة إذا كانت الإحداثيات جاهزة. التاجر والمندوب لا يرسلان هذا المسار (`presenceEndpointForRole` يرجع null لغير service/transport)
- الاستعلام الأول: `users.update({ last_seen_at }).eq("id", uid)`
- إن طابقت رسالة الخطأ `last_seen_at`: `update({ updated_at })` ثم HTTP 200 مع `persisted: "updated_at"`
- retry: نعم، استعلام فاشل ثم استعلام ناجح. لا يوجد تخطٍّ للعمود قبل الإرسال
- تقدير تبويب ظاهر 24 ساعة: **1,152 خطأ** Postgres. التبويب المخفي يوقف المؤقت
- نسخة `ervenow-frontend/assets/portal-provider-location.js` لا تنادي `/me/presence`. إن كان هذا ما يحمّله المتصفح، هذا البند لا يعمل

جمع البندين 1 و 2 لتبويب إدارة مفتوح 24 ساعة (سوكيت متصل) + بوابة خدمة ظاهرة 24 ساعة = **4,032 خطأ**. المرصود 4,687. الفرق نحو 650 يغطيه تبويب ثانٍ جزئي، أو فتح لوحة العملاء/المزوّدين، أو ساعات انقطاع سوكيت

### 3) قوائم الإدارة التي تختار `last_seen_at` أولًا — خطأ مؤكد عند كل فتح، ليس حلقة دائمة في الصفحة الحيّة

- `GET /api/admin/customers` في `apps/admin/routes.js`: أول select يتضمن `last_seen_at`، ثم يسقط العمود
- `GET /api/admin/providers`: نفس النمط، ثلاث صيغ select، الأولى فيها `last_seen_at`
- `loadRegistrationApprovalItems` في `shared/services/registrationApprovals.js` عبر `GET /api/admin/registration-approvals`
- المعدّل على الصفحة الحيّة: عند فتح اللوحة، لا كل 30 ثانية. `public/admin/modules/dashboard.js` يستدعي الثلاثة كل 120 ثانية داخل `getCommandCenterMetrics`، لكن `admin-dashboard.html` لا يحمّل هذا الملف
- retry: نعم، محاولة فاشلة ثم صيغة بلا العمود
- تقدير: عشرات إلى مئات في اليوم إن فُتحت اللوحات يدويًا. لا تفسّر 4,687 وحدها إلا إذا كانت نسخة الوحدات هي المشغّلة (ليست كذلك في `public/admin-dashboard.html`)

### 4) إحصاءات لوحة الإدارة — احتمال قوي لحرق Disk IO، وخطأ Postgres فقط إذا عمود في select الأول ناقص

- الملف: `computeAdminDashboardStats` في `apps/admin/routes.js`، المسار `GET /api/admin/stats`
- الواجهة: `loadStats` كل **30 ثانية** من `public/admin-dashboard.html` بلا إيقاف عند الإخفاء
- كاش عملية الخادم: **90 ثانية** (`ADMIN_STATS_CACHE_MS`). الضرب الفعلي للقاعدة أقرب إلى كل 90 ثانية = **960 دورة / يوم** لتبويب واحد
- كل دورة بعد الكاش: 3 عمليات `count` على `orders`، ثم `paginatedSelectWithFallback` يسحب كل صفوف `orders` صفحات من 1000 حتى 80 صفحة (سقف 80,000 صف) بصيغة أعمدة الإيراد، ثم صفحة الرسم
- إن فشل أول تعبير select لعمود ناقص: خطأ Postgres ثم تعبير تالٍ. هذا احتمال مشروط، غير مؤكد من هذه الجلسة
- retry: نعم داخل `paginatedSelectWithFallback` عند `isSchemaMissingError` فقط
- هذا المرشح الأقوى لتنبيه Disk IO: قراءة الجدول كاملًا نحو 960 مرة/يوم بينما CPU منخفض

### 5) ملخص المالية — احتمال قوي إن كانت الدالة أو الجدول ناقصين، وضعيف إن كانت الهجرة مطبّقة

- `GET /api/admin/finance-summary` كل **15 ثانية** من نفس الصفحة، بلا إيقاف عند الإخفاء
- الخادم: `getAdminFinanceSummaryFromLedger` وكاش **90 ثانية**، ثم `rpc("ervenow_ledger_finance_summary")`
- تقدير ضرب القاعدة: نحو **960 / يوم** لا 5,760
- إن كانت الدالة غير موجودة: كل دورة بعد الكاش خطأ `42883` ثم تراجع. 960 خطأ لا تكفي وحدها لـ 4,687، وتكفي لتضخيم السجل
- `GET /api/admin/platform-treasury` يستدعي `admin_platform_treasury_summary` عند فشل مسار الـ ledger. هذا عند الطلب، وليس مؤقتًا مستقلًا في الصفحة الحيّة إلا عبر لوحة الأوامر في ملف الوحدات غير المربوط

### 6) لوحة مزود الخدمة — احتمال قوي للحجم، وخطأ متكرر فقط إذا عمود/جدول/دالة ناقصة

- `public/assets/service-preview.js` الدالة `pollTick` / `loadData` كل **30 ثانية**، ويتوقف عند `document.hidden`
- كذلك `public/services-provider.html` الدالة `loadDashboard` كل **30 ثانية** مع إيقاف عند الإخفاء
- كل دورة: `GET /api/services/me/dashboard` ثم `GET /api/wallet/transactions` ثم تحديث إشعارات
- الخادم في `/me/dashboard`: مصادقة (`users` بـ `id, role, status, phone, name`)، ملف المستخدم مع `lat, lng` عبر `usersQueryResilient`، حتى 200 طلب، ثم `provider_commission_debts`، ثم `getWalletPayloadWithLedgerFallback`
- المحفظة تجرب `rpc("ervenow_ledger_wallet_aggregate")` أولًا. إن غابت الدالة فهذا خطأ في كل دورة ثم مسار بديل. غير مؤكد أن الدالة غائبة
- `provider_commission_debts`: عميل Supabase لا يرمي استثناء عند غياب الجدول؛ الخطأ يُسجَّل في Postgres ويُتجاهل في الكود (`data` فارغ). مشروط بغياب الجدول
- تقدير تبويب ظاهر 24 ساعة: **2,880 دورة**. كل دورة عدة استعلامات ناجحة. هذا يفسّر جزءًا كبيرًا من 25,197 طلب بوابة، لا 4,687 خطأ، ما دامت الأعمدة موجودة
- نسخة `ervenow-frontend` ما زالت على **8 ثوانٍ** = **10,800 دورة / يوم** إن كانت هي المنشورة

### 7) بوابة النقل — نفس بند 6

- `public/assets/transport-preview.js` كل **30 ثانية** مع إيقاف عند الإخفاء، ونبضة حضور إن كان الموقع جاهزًا (البند 2)
- نسخة الواجهة القديمة: **8 ثوانٍ**

### 8) عمّال الخادم وهم بلا مستخدم — احتمال ضعيف للأخطاء، ومؤكد للحجم الهادئ

تعمل من `server/server.js` طالما العملية تعمل، حتى بلا طلبات بشرية:

| العامل | الملف | الفترة | الاستعلام | retry |
|---|---|---|---|---|
| توسيع نصف قطر الغاز | `apps/delivery/gasRadiusExpand.js` | 60 ثانية، وبعد نتيجة فارغة يتراجع 3 دقائق | `orders` حيث `service_type = gas_delivery` وحالة new/pending وبلا `provider_id` حد 40 | عند timeout فقط، عبر `backgroundPause` دقيقتين بعد مهلتين |
| إعادة إشعارات المندوب | `apps/driver/retryNotifications.js` | 60 ثانية بلا تراجع عند الفراغ | `driver_notifications` حيث `status = failed` و `attempts < 3` حد 10 | عند فشل الإرسال يحدّث `attempts`. جلب القائمة لا يُعاد إلا في الدورة التالية |
| صيانة الموقع | `shared/utils/siteMaintenanceStore.js` | 45 ثانية | `platform_settings` المفتاح `site_maintenance_enabled` | لا. عند غياب الجدول يُبلع الخطأ في `upsert`، والقراءة قد ترمي |
| الخريطة العامة | `shared/utils/liveMapPublicStore.js` | 45 ثانية | `platform_settings` المفتاح `live_map_public_enabled` | لا |
| حذف الطلبات المغلقة | `apps/delivery/purgeClosedOrders.js` | أول مرة بعد 60 ثانية ثم كل 24 ساعة | دفعات `orders` المغلقة الأقدم من سنة | لا حلقة إعادة على الخطأ |

تقدير يوم هادئ بلا طلبات غاز: نحو 480 (غاز) + 1,440 (إشعارات) + 1,920 + 1,920 (إعدادات) ≈ **5,800 استعلام ناجح** إن كانت الجداول موجودة. هذا جزء من البوابة لا من سلة الأخطاء. إن غاب `driver_notifications` أو `platform_settings` يتحول العامل إلى خطأ كل دورة (1,440 أو 1,920). ذلك احتمال مشروط، ولم يُفحص الكتالوج الحي في هذه الجلسة.

`backgroundPause` يوقف العامل دقيقتين بعد مهلتين متتاليتين. ليس عاصفة إعادة.

### 9) قوائم الطلبات مع تراجع الأعمدة — احتمال ضعيف إلا إذا عمود من select الأول ناقص فعلًا

- `apps/delivery/service.js` الدالة `listOrders`: select كامل، ثم نسخة عميل أقصر، ثم minimal. كل فشل عمود = خطأ Postgres قبل النجاح
- `shared/utils/ordersSchemaOptional.js` الدالة `selectOrdersResilient`: تحذف عمودًا ناقصًا وتعيد، بسقف = عدد الأعمدة + 2. تُستدعى من لوحة التاجر (`apps/store/routes.js`) ومن طلبات المندوب المكتملة (`apps/driver/routes.js`)
- المعدّل يتبع استطلاع الصفحة: تاجر **45 ثانية** (`public/assets/merchant-preview.js` → `/api/store/order-board`)، مندوب **45 ثانية**، رئيسية **45 ثانية** (`public/index.html` → `/api/order/orders`)
- إن كان select الأول سليمًا: صفر أخطاء. إن نقص عمود واحد: خطأ في كل دورة = **1,920 / يوم** لكل تبويب ظاهر

### 10) مصادقة كل طلب — احتمال ضعيف حاليًا

- `shared/middleware/auth.js` الدالة `requireAuth`
- كل طلب فيه Bearer يعمل `users.select("id, role, status, phone, name")`
- التراجع يحدث فقط إذا غاب `name` أو `status`. لا يلمس `last_seen_at`
- إن كان العمودان موجودين: استعلام ناجح لكل طلب API، وهذا حجم لا أخطاء
- تقدير: يساوي تقريبًا عدد طلبات API المصادَق عليها، وهو داخل الـ 25,197 لا داخل الـ 4,687

## B) كل الاستعلامات التي تشير إلى `last_seen_at`

العمود `public.users.last_seen_at` غير موجود (مؤكد من فحص `information_schema` السابق ومن هذه الجلسة: لا تنفيذ للهجرة). الملف `shared/migration_users_last_seen_at.sql` موجود في المستودع ولم يُشغَّل من هنا.

| المكان | ماذا يفعل | هل يضرب Postgres قبل التراجع؟ |
|---|---|---|
| `apps/services/routes.js` `POST /me/presence` | `update({ last_seen_at })` ثم عند تطابق الرسالة `update({ updated_at })` | **نعم. كل نبضة** |
| `apps/admin/routes.js` `attachUserIdsToDrivers` | `select id, phone, last_seen_at` ثم `select id, phone` | **نعم. كل `GET /drivers`** |
| `apps/admin/routes.js` `GET /customers` | أول عنصر في `customerSelects` يتضمن العمود | **نعم. كل فتح للقائمة** |
| `apps/admin/routes.js` `GET /providers` | أول تعبير select يتضمن العمود | **نعم. كل فتح للقائمة** |
| `shared/services/registrationApprovals.js` | أول select يتضمن العمود | **نعم. كل تحميل موافقات** |
| `shared/utils/lastActivityAt.js` | قراءة حقل من صف وصل أصلًا | لا استعلام |
| `public/admin/modules/drivers.js` و `panels.js` و `services.js` و `transport.js` | عرض `last_seen_at \|\| updated_at \|\| created_at` | لا استعلام مباشر |
| `tests/unit/lastActivityAt.test.js` | اختبار وحدة | لا |

لا يوجد في الكود مسار يتحقق من `information_schema` قبل الإرسال. التراجع كله بعد فشل الاستعلام.

نبضة واحدة ظاهرة = خطأ Postgres واحد مؤكد، ثم كتابة `updated_at` الناجحة. واجهة المستخدم ترى نجاحًا (`persisted: "updated_at"`). سجل Postgres يرى `column ... last_seen_at does not exist`.

`updated_at` في التراجع يغيّر وقت تعديل الحساب في كل نبضة. هذا أثر جانبي موثّق سابقًا، وليس مصدر عدّاد الأخطاء.

## C) حلقات الاستطلاع الحالية

«يضرب القاعدة» يعني أن الدورة تصل إلى API الخادم ومنه إلى PostgREST. المؤقتات المحلية (ساعة، سلايدر، ETA على الشاشة) لا تُحسب.

### خادم — تعمل بلا زائر

| المصدر | الفترة | يضرب القاعدة بلا عمل فعلي؟ |
|---|---|---|
| `gasRadiusExpand.js` | 60 ثانية، ثم 3 دقائق إن لم يوجد طلب غاز معلّق | نعم، استعلام فارغ |
| `retryNotifications.js` | 60 ثانية | نعم، حتى لو صفر صفوف فاشلة |
| `siteMaintenanceStore.js` | 45 ثانية | نعم |
| `liveMapPublicStore.js` | 45 ثانية | نعم |
| `purgeClosedOrders.js` | 24 ساعة (وأول تشغيل بعد 60 ثانية) | استعلام حتى لو لم يوجد ما يُحذف |

### متصفح — `public/` وهو ما يقدّمه Express

| المصدر | الفترة | إيقاف عند إخفاء التبويب | endpoint |
|---|---:|---|---|
| `public/admin-dashboard.html` إحصاءات + خريطة حية | 30 ثانية | لا | `/api/admin/stats` و `/api/admin/drivers` |
| `public/admin-dashboard.html` مالية | 15 ثانية | لا | `/api/admin/features` و `/api/admin/finance-summary` |
| `public/admin-dashboard.html` احتياط السوكيت | 10 ثوانٍ عند الانقطاع فقط | لا | `/api/admin/orders` و `/api/admin/drivers` |
| `public/admin-dashboard.html` تنبيهات SLA | 30 ثانية | لا فحص | رسم من الذاكرة، لا جلب جديد بذاته |
| `public/assets/service-preview.js` | 30 ثانية | نعم | `/api/services/me/dashboard` + محفظة + إشعارات |
| `public/services-provider.html` | 30 ثانية | نعم | `/api/services/me/dashboard` |
| `public/assets/transport-preview.js` | 30 ثانية | نعم | لوحة النقل |
| `public/assets/portal-provider-location.js` | 75 ثانية | نعم | `POST /api/services/me/presence` لـ service/transport فقط |
| `public/assets/merchant-preview.js` | 45 ثانية | نعم | `/api/store/order-board` |
| `public/assets/driver-preview.js` طلبات | 45 ثانية | نعم | طلبات المندوب |
| `public/assets/driver-preview.js` موقع | 15 ثانية (السطر 39 يلغي السطر 21 الذي كان 8 ثوانٍ) | جزئي (`document.hidden`) | `POST /api/driver/update-location` |
| `public/driver.html` قائمة | 45 ثانية | نعم | طلبات |
| `public/driver.html` محفظة | 60 ثانية | نعم | محفظة |
| `public/driver.html` حضور بلا رحلة | 15 ثانية | نعم | `update-location` |
| `public/driver.html` موقع أثناء رحلة | 8 ثوانٍ | لا على المؤقت نفسه | `update-location` |
| `public/driver-app.html` | 8 ثوانٍ أثناء طلب نشط فقط | نعم | موقع |
| `public/assets/driver-operational.js` قرب | 5 ثوانٍ أثناء رحلة فقط | لا مؤقت إخفاء | قد يغيّر حالة الطلب |
| `public/orders.html` | 45 ثانية | نعم | `/api/order/orders` |
| `public/index.html` عدّاد الطلبات | 45 ثانية | نعم | `/api/order/orders` إن كان الدور driver أو admin |
| `public/assets/mobile-orders-nav-badge.js` | 45 ثانية | نعم | شارة الطلبات |
| `public/track.html` مسار | 7.8 ثانية أثناء تتبع حي | — | تحديث مسار، ليس حلقة عامة |
| `public/assets/checkout-engine.js` | 2 ثانية | سقف 30 محاولة | دفع قيد التنفيذ فقط |

`public/admin/modules/*` (120 ثانية + إيقاف عند الإخفاء) غير مربوطة بصفحة الإدارة الحالية.

### `ervenow-frontend/` إن نُشرت بلا مزامنة من `public/`

| المصدر | الفترة | ملاحظة |
|---|---:|---|
| `ervenow-frontend/assets/service-preview.js` | 8 ثوانٍ | 10,800 دورة/يوم للتبويب الظاهر |
| `ervenow-frontend/assets/transport-preview.js` | 8 ثوانٍ | نفس النمط |
| `ervenow-frontend/assets/portal-provider-location.js` | 15 ثانية | يكتب `PATCH /me/location` لا `last_seen_at` |
| `ervenow-frontend/assets/mobile-orders-nav-badge.js` | 5 ثوانٍ | أسرع من `public/` (45 ثانية) |
| `ervenow-frontend/admin-dashboard.html` | 30 / 15 ثانية | مطابق لـ `public/` في هذين المؤقتين |

فحص المتصفح لعنوان سكربت البوابة (`portal-provider-location.js` هل فيه `PRESENCE_HEARTBEAT_MS = 75000` أم `intervalMs || 15000`) يحسم أي شجرة تعمل في الإنتاج. هذا لم يُفتح في هذه الجلسة.

## D) حلقات إعادة المحاولة المرتبطة بقاعدة البيانات

| المكان | السلوك | هل يضاعف خطأ SQL؟ |
|---|---|---|
| `apps/services/routes.js` حضور | فشل `last_seen_at` ثم `updated_at` | نعم، مرة واحدة مؤكدة لكل نبضة |
| `attachUserIdsToDrivers` و customers و providers و registrationApprovals | فشل select ثم select أقصر | نعم، مرة واحدة مؤكدة لكل استدعاء |
| `paginatedSelectWithFallback` و `safeSelectRowsWithFallback` | تعبير select تالٍ عند نقص مخطط | فقط إذا فشل الأول |
| `selectOrdersResilient` | يحذف العمود الناقص ويعيد، بسقف عدد الأعمدة + 2 | فقط إذا فشل عمود |
| `apps/delivery/service.js` `listOrders` | حتى 3 صيغ select | فقط إذا فشل السابق |
| `usersQueryResilient` | يسقط `lat, lng` ويعيد | فقط إذا غاب العمودان |
| `requireAuth` | يسقط `name` ثم `status` | فقط إذا غابا. لا علاقة بـ `last_seen_at` |
| `shared/config/supabase.js` `wrapFetchWithRetry` | حد **2** محاولات، وعلى أخطاء الشبكة فقط: `ECONNRESET` `ETIMEDOUT` `ENOTFOUND` `UND_ERR_CONNECT_TIMEOUT` `fetch failed`. أخطاء SQL ترجع HTTP من PostgREST فلا تُعاد هنا. المهلة تُرمى بلا إعادة | لا يضاعف 42703 |
| `public/assets/api.js` | `MAX_IDEMPOTENT_HTTP_RETRIES = 0` | لا إعادة HTTP من المتصفح الحالي |
| `backgroundPause` | إيقاف دقيقتين بعد مهلتين، لا إعادة فورية | يخفف ولا يضاعف |
| `checkout-engine.js` | حتى 30 مرة كل 2 ثانية لعملية دفع واحدة | ليس حلقة خلفية |
| `apps/driver/retryNotifications.js` | كل 60 ثانية لصفوف `failed` حتى 3 محاولات إرسال | ليس عاصفة استعلام. تحديث صف عند فشل واتساب |

لا توجد عاصفة retry بلا سقف على أخطاء العمود. الموجود هو **زوج مؤكد: خطأ ثم نجاح** في كل مرة يُذكر فيها `last_seen_at`.

## E) استعلامات تُنفَّذ بلا مستخدم أو طلب أو عمل

مؤكدة من تشغيل الخادم وحده:

1. غاز معلّق: استعلام كل دقيقة، ثم كل 3 دقائق إذا كانت النتيجة فارغة.
2. إشعارات فاشلة: استعلام كل دقيقة حتى لو القائمة فارغة.
3. `platform_settings` للصيانة كل 45 ثانية.
4. `platform_settings` للخريطة العامة كل 45 ثانية.
5. حذف الطلبات القديمة: مرة يوميًا.
6. `GET /api/health` في `railway.toml` لا يلمس القاعدة. `GET /api/health/full` يعمل `users.select("id").limit(1)` لكل ضربة. فحص Railway الحالي هو `/api/health` لا المسار العميق.

هذه بنود حجم (آلاف الطلبات الناجحة/يوم) لا تفسير لـ 97.5% فشل في سلة PostgreSQL، إلا إذا كان الجدول أو المفتاح نفسه غائبًا فيتحول كل دورة إلى خطأ.

## F) مسار يفشل ثم يُستدعى باستمرار

هذا هو النمط الذي يطابق 4,687 خطأ مع 757 خطأ بوابة فقط:

1. **`GET /api/admin/drivers` كل 30 ثانية** (وكل 10 ثوانٍ إذا انقطع السوكيت). الاستعلام الأول يفشل دائمًا اليوم. الاستجابة للوحة 200 بعد التراجع. Postgres يسجّل خطأ كل مرة.
2. **`POST /api/services/me/presence` كل 75 ثانية** على بوابة خدمة/نقل ظاهرة تحمّل سكربت `public/`. نفس النمط: فشل ثم 200.
3. **`GET /customers` و `GET /providers` و موافقات التسجيل** عند كل فتح: فشل أول select ثم نجاح. ليست مؤقت 30 ثانية في الصفحة الحيّة.
4. المالية كل 15 ثانية (ضرب قاعدة كل 90 ثانية) تفشل باستمرار **فقط** إذا `ervenow_ledger_finance_summary` غير موجودة. غير محسوم من الكود وحده.
5. لوحة الخدمة كل 30 ثانية تفشل باستمرار **فقط** إذا عمود أو RPC أو جدول الديون ناقص. غير محسوم إلا لـ `last_seen_at` وهو ليس داخل `/me/dashboard`.

لا يوجد في الكود الحالي إعادة تلقائية على HTTP 400 من المتصفح (`MAX_IDEMPOTENT_HTTP_RETRIES = 0`). التكرار يأتي من المؤقت الذي يعيد الطلب المنطقي، لا من عاصفة على نفس الفشل الشبكي.

## G) تصنيف الثقة

### خطأ مؤكد من الكود

- أي استدعاء يصل إلى الاستعلامات الخمسة في القسم B يولّد خطأ PostgreSQL `42703` قبل التراجع، لأن العمود غير موجود والتراجع يحدث بعد الخطأ لا قبله.
- أعلى معدّل مؤكد: `GET /api/admin/drivers` من مؤقت 30 ثانية في `public/admin-dashboard.html` بلا إيقاف عند إخفاء التبويب.
- ثاني معدّل مؤكد مشروط بوصول النبضة: `POST /api/services/me/presence` كل 75 ثانية.
- التراجع إلى `updated_at` لا يمنع تسجيل الخطأ.

### احتمال قوي

- تبويب إدارة واحد مفتوح معظم اليوم يفسّر آلاف الأخطاء وحده (2,880 في 24 ساعة متصلة، والسوكيت متصل).
- تبويب إدارة + بوابة خدمة ظاهرة يقتربان من 4,687 (4,032 في 24 ساعة متصلة). الفرق الباقي معقول لتبويب جزئي أو فتح لوحات أخرى أو انقطاع سوكيت لساعات.
- Disk IO من `computeAdminDashboardStats` الذي يقرأ `orders` على صفحات كل ~90 ثانية بينما التبويب مفتوح. هذا يفسّر التنبيه مع CPU 6% أفضل مما تفسّره أخطاء العمود الخفيفة.
- بقاء أخطاء البوابة قرب 750 (744 أمس، 757 اليوم) بعد انخفاض الحجم: تيار أخطاء لا يتبع تباطؤ الاستطلاع. مرشحه إما 5xx/مهلة وإما مسار لا يمر بتراجع، ويُحسم من سجل البوابة لا من الكود.
- انحراف `ervenow-frontend/` (8 ثوانٍ و 5 ثوانٍ) إن كان هو المنشور: يرفع حجم البوابة ولا يضيف `last_seen_at` لأنه لا ينادي `/me/presence`.

### احتمال ضعيف

- عاصفة retry شبكية. السقف الحالي محاولتان وعلى انقطاع TCP فقط، والمتصفح لا يعيد HTTP.
- `requireAuth` كمصدر للـ 4,687. لا يختار `last_seen_at`.
- Realtime في Supabase. التتبع الحي Socket.IO. لا `.channel(` تشغيلي يفسّر هذا الحجم.
- عمّال الغاز والإشعارات كمصدر للأخطاء ما دامت الجداول موجودة. هم مصدر استعلامات فاضية ناجحة.
- `duplicate key` و `statement timeout` و `permission denied` كسبب رئيسي. لا حلقة في الكود تولّدها آلاف المرات. تبقى ممكنة كسطور قليلة داخل السجل إلى أن يُفتح.

## H) ROOT CAUSE CANDIDATES

مرتبة بالدليل، بلا إصلاح:

1. **`users.last_seen_at` يُستعلم قبل التراجع، والعمود غير موجود.** أقوى دليل في الكود، ويطابق سلة PostgreSQL الفاشلة بنسبة 97.5% مع بقاء HTTP ناجحًا. أكبر مضخة زمنية هي `GET /api/admin/drivers` كل 30 ثانية من الصفحة الحيّة، ثم نبضة `/me/presence` كل 75 ثانية إن كان سكربت `public/` هو ما يعمل في المتصفح.
2. **قراءة كل صفوف `orders` من `/api/admin/stats` كل ~90 ثانية ما دام تبويب الإدارة مفتوحًا، حتى في الخلفية.** أقوى تفسير لتنبيه Disk IO مع CPU منخفض. ليس بالضرورة مصدر الـ 4,687 إلا إذا فشل select الإيراد.
3. **تبويب بوابة تشغيلية (خدمة/نقل/تاجر/مندوب) ترك مفتوحًا.** يفسّر أغلب الـ 25,197 طلب بوابة. الاستطلاع في `public/` صار 30–45 ثانية. إن كانت نسخة Vercel القديمة (8 ثوانٍ) ما زالت تُخدَم، الحجم أعلى. هذه طلبات ناجحة في الغالب، لا أخطاء العمود، باستثناء النبضة.
4. **دالة ledger أو جدول إعدادات ناقص على مسار مؤقت** (`ervenow_ledger_finance_summary` كل ~90 ثانية، أو `platform_settings` / `driver_notifications` من العمّال). ممكن أن يضيف مئات إلى ألفَي خطأ/يوم. غير مثبت بدون السجل.
5. **انقطاع TCP أو Auth** كما في تشخيص أمس. أخطاء البوابة لم تنزل عن ~750. لا يفسّر 4,687 سطر Postgres من نوع 42703، وقد يفسّر جزء نسبة النجاح 65% إذا كانت خدمات أخرى داخل المجموع.

لا يوجد في الكود الحالي retry storm بلا سقف. يوجد فشل مقصود-بالترتيب ثم نجاح، يتكرر لأن المؤقت لا يتذكر أن العمود غائب.

## ماذا نحتاج من Supabase Logs

سجلات التطبيق لا تحفظ نص خطأ Postgres لكل نبضة حضور (التراجع يصمت ويعيد 200). لا يمكن من الكود وحده نسبة الـ 4,687 إلى مرشح واحد برقم نهائي.

افتح **Logs → Postgres** لآخر 24 ساعة:

- الشدة: `error`
- ابحث عن النص: `last_seen_at`
- ثم جمّع `event_message` (أو الخطأ المختصر) وعدّ التكرار

الفلاتر النصية التي تفصل السبب:

- `last_seen_at` و `42703` — المرشح 1. إن اقترب العدد من 4,687 فالقائمة مغلقة لصالح هذا العمود
- `does not exist` بدون `last_seen_at` — جداول أو أعمدة أخرى (ديون، إعدادات، إشعارات)
- `function` و `42883` — RPC مالي
- `42501` أو `permission denied` أو `row-level security` — RLS
- `23505` — مفتاح مكرر
- `invalid input syntax` — نوع خاطئ
- `57014` أو `statement timeout` — مهلة
- `08006` أو `08001` أو `connection` — اتصال
- `40001` أو `40P01` — معاملة / deadlock

ثم **Logs → API Gateway** لآخر 24 ساعة:

- `status_code >= 500` لمعرفة إن كانت الـ 757 أخطاء بوابة حقيقية
- `status_code = 400` مع مسار `/rest/v1/users` — هذه أخطاء العمود إن كانت اللوحة لا تعدّ 400 ضمن «API Gateway Errors»

و **Logs → Auth** إن بقيت نسبة النجاح الكلية 65% بعد طرح أخطاء Postgres: تشخيص أمس كان فيه Auth شبه فاشل بالكامل، وهو خارج مسارات `supabase.auth` في تطبيق ERVENOW.

لا تُشغَّل الهجرة ولا يُغيَّر المؤقت قبل قراءة هذا التجميع. إن طابق عدّ `last_seen_at` معظم الـ 4,687، السبب الأقوى مثبّت بالقياس لا بالتخمين.
