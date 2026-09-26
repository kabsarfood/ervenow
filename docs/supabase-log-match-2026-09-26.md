# مطابقة مصادر الضغط — آخر 24 ساعة
التاريخ: 2026-09-26
النطاق: تشخيص فقط. لم يُنفَّذ تعديل. شريط الأعلى تقييماً / الأكثر طلباً مستبعد.

## ما تم قياسه فعلاً

لا يوجد في المستودع سجل طلبات لآخر 24 ساعة. عدادات Prometheus في الذاكرة (`/api/internal/metrics`) تُحسب منذ تشغيل العملية فقط، وتُفعَّل إذا كان `METRICS_ENABLED=1`. لا تُحفظ على قرص.

محاولة قراءة `pg_stat_statements` عبر `SUPABASE_DB_URL` (منفذ 5432 المباشر) انتهت بـ `timeout expired` خلال نحو 8 ثوانٍ. هذا نفس صنف `CONNECT_TIMEOUT` الذي أظهره Advisor. لذلك لا يوجد عدد استعلامات مقاس من Postgres في هذه الجلسة.

`railway logs` متاح في الجهاز (الإصدار 4.47.1) ويدعم فلترة HTTP بـ `@path` و `@clientUa` و `@srcIp` و `--since 1d`. الجلسة الحالية: `Unauthorized` / `invalid_grant`. لا يمكن سحب لوجات آخر 24 ساعة قبل `railway login`.

Supabase CLI غير مثبّت. لا يوجد رمز إدارة Supabase في البيئة، فمسارات `/auth/v1/*` و User-Agent و IP غير ظاهرة من هنا.

النتيجة: أعداد الـ 40,200 والـ 6,560 ما زالت من لوحة Supabase فقط. الجدول التالي يربط المسار بالجدول وبالنمط الزمني من الكود. عمود «مقاس 24 ساعة» فارغ عن قصد.

## الجدول

المسار | نمط الكود | جداول Supabase التي يلمسها | طلبات HTTP/ساعة إذا بقي التبويب ظاهراً | ضرب PostgREST التقريبي/ساعة | مقاس من اللوج

GET /api/services/me/dashboard | كل 8 ثوانٍ من /service-preview و services-provider.html و /transport-preview | users (مصادقة + ملف) ، orders (حتى 200) ، provider_commission_debts ، ervenow_ledger_wallets ، ervenow_ledger_transactions (كل الحركات المكتملة بلا limit، ثم حتى 200) | 450 | نحو 2,700–4,500 | غير مقاس
GET /api/wallet/transactions | مع كل دورة 8 ثوانٍ في نفس البوابات | users ، ervenow_ledger_wallets ، ervenow_ledger_transactions (حد 100) | 450 | نحو 900–1,350 | غير مقاس
GET /api/notifications و /api/notifications/unread-count | refresh الإشعارات داخل نفس دورة 8 ثوانٍ. unread-count يجلب حتى 100 غير مقروء ولا يعدّ فقط | users ، notifications (مرة لكل recipient type: الدور و provider) | 900 (نداءان × 450) | نحو 1,800–3,600 | غير مقاس
GET /api/driver/orders | كل 45 ثانية في driver.html و driver-preview.js | users ، orders (عدة select) ، drivers | 80 | نحو 300–500 | غير مقاس
POST /api/driver/update-location | كل 8 ثوانٍ في معاينة المندوب وأثناء رحلة driver-app؛ كل 15 ثانية حضور في driver.html | users ، orders ، drivers | 450 عند فترة 8 ثوانٍ | نحو 900–1,800 | غير مقاس
GET /api/driver/wallet و /api/core/me | محفظة المندوب كل 60 ثانية؛ me مع دورات أخرى | users ، جداول ledger | 60 للمحفظة | مئات | غير مقاس
GET /api/admin/stats | كل 30 ثانية إذا لوحة الإدارة مفتوحة | users ، orders (عدّ 3 مرات + سحب كل الصفوف صفحات 1000 حتى 80 صفحة، مرتين) | 120 | من نحو 600 إلى عشرات الآلاف إذا الجدول كبير أو select يفشل | غير مقاس
GET /api/admin/finance-summary و /api/admin/features | كل 15 ثانية في لوحة الإدارة | users ، ervenow_ledger_* ، withdraw_requests | 240 | نحو 500–1,000 | غير مقاس
GET /api/admin/drivers و GET /api/admin/orders | كل 30 ثانية مع اللوحة؛ كل 10 ثوانٍ إذا Socket.IO منقطع | users ، drivers ، orders | 120 أو 360 | مئات إلى آلاف | غير مقاس
GET /api/core/marketing/home | مرة عند فتح الرئيسية، و cache: no-store. ليس مؤقت 8 ثوانٍ | hero_banners نحو 17 select (هدف لكل مكان) ، platform_settings للعروض | 0 بعد الفتح. 1 HTTP لكل مشاهدة | نحو 18 استعلام لكل مشاهدة | غير مقاس
GET /api/core/hero-banner | لا مؤقت في الشريط. المسار الفعلي تحت /api/core وليس /api/hero-banner | hero_banners مرتين ≈ 34 select | حسب من يستدعيه | حتى 34 لكل ضربة | غير مقاس
GET /api/stores | فتح الرئيسية وعداد المتاجر، لا حلقة الشريط | stores ، وربما تصنيفات | 0/ساعة بعد الفتح | 1–3 لكل مشاهدة | غير مقاس
GET /api/store/products | مرة لأول متجر عند رسم «الأكثر طلباً» | products | 0/ساعة بعد الفتح | 1 لكل مشاهدة | غير مقاس
عمال الخادم | غاز وإشعارات فاشلة كل 60ث؛ صيانة وخريطة كل 45ث | orders ، driver_notifications ، platform_settings | نحو 180–240 | نحو 250–350 | غير مقاس
إعادة المحاولة | عند CONNECT_TIMEOUT: الخادم حتى ×5، المتصفح حتى ×4 | نفس جداول الطلب الفاشل | يضاعف الصف الذي فشل | حتى ×20 على الطلب الفاشل | غير مقاس
/auth/v1/* | لا استدعاء supabase.auth في كود التشغيل | auth.users داخل GoTrue، وليس جداول التطبيق | غير معروف | 6,560 خطأ من لوحة 24 ساعة، بلا User-Agent هنا | غير مقاس

## Top 10 من الكود إذا كانت البوابات مفتوحة — ليس من اللوج

هذا ترتيب متوقع، لا ترتيب مقاس. لا يُستخدم لتقرير الإصلاح النهائي قبل اللوج.

1. دورة بوابة الخدمة/النقل كل 8 ثوانٍ مجتمعة: dashboard + wallet/transactions + notifications + unread-count. نحو 2,250 طلب HTTP/ساعة وعدة آلاف PostgREST/ساعة. الجداول: users, orders, notifications, ervenow_ledger_wallets, ervenow_ledger_transactions, provider_commission_debts.
2. سحب كل حركات ledger داخل dashboard بلا limit. يضخم البند 1 على جدول ervenow_ledger_transactions.
3. GET /api/core/marketing/home: نحو 17 استعلام hero_banners لكل فتح رئيسية. لا نمط 8 ثوانٍ. يفسّر حجماً كبيراً فقط إذا كثرت المشاهدات.
4. لوحة الإدارة كل 30 ثانية على orders إذا التبويب مفتوح، وتصير الأثقل إذا الصفحات وصلت سقف 80.
5. POST /api/driver/update-location كل 8 أو 15 ثانية: orders + drivers.
6. GET /api/driver/orders كل 45 ثانية.
7. المالية الإدارية كل 15 ثانية.
8. احتياط الإدارة كل 10 ثوانٍ عند انقطاع Socket.IO.
9. عمال الدقيقة على orders و driver_notifications و platform_settings. آلاف في اليوم لا عشرات الآلاف.
10. إعادة المحاولة ×5 / ×4 بعد CONNECT_TIMEOUT. تضاعف أي بند أعلاه بعد انقطاع TCP. لا تُنشئ الـ 40,200 الناجحة بنسبة 98.1%.

شريط الرئيسية مستبعد: 0 طلب/ساعة بعد الفتح.

## أنماط الزمن التي نبحث عنها في اللوج

- كل 8 ثوانٍ على /api/services/me/dashboard و /api/wallet/transactions و /api/notifications: بوابة خدمة أو نقل مفتوحة.
- كل 8 ثوانٍ على /api/driver/update-location: مندوب.
- كل 15 ثانية: حضور موقع المندوب أو ملخص مالية الإدارة.
- كل 30 ثانية: /api/admin/stats.
- كل 45 ثانية: /api/driver/orders أو عدّ طلبات الرئيسية.
- بلا إيقاع ثابت وعلى /api/core/marketing/home: مشاهدات رئيسية، وكل ضربة ≈ 17 استعلام hero_banners.
- انفجار أخطاء متتالية بفارق أجزاء من الثانية على نفس المسار: إعادة المحاولة بعد المهلة، لا مؤقت جديد.

## Auth: 6,560 خطأ

كود التشغيل لا ينادي supabase.auth ولا /auth/v1. فشل Auth لا يمر من مسارات الجدول أعلاه. User-Agent و IP غير متاحين من المستودع ولا من اتصال 5432 الذي انقطع.

المطابقة تكون من Supabase → Logs → Auth، أو من API logs على المسارات التي تبدأ بـ /auth/v1. نبحث عن path و User-Agent و status. إن كان المسار /token أو /signup من متصفح أو ماسح، فالطلبات خارجية على المفتاح المنشور من GET /api/core/public-config. إن كانت الطلبات health داخلية من GoTrue أثناء TCP timeout، فهي عرض انقطاع القاعدة وليست حلقة تطبيق.

## ماذا يفتح العدد الحقيقي

بعد `railway login` على نفس الجهاز:

railway logs --http --since 1d --lines 10000 --filter "@path:/api/services/me/dashboard"
railway logs --http --since 1d --filter "@path:/api/core/marketing/home"
railway logs --http --since 1d --filter "@path:/api/driver/update-location"

حقول اللوج المفيدة: @path و @clientUa و @srcIp و @httpStatus و @method.

بدون هذه الأسطر يبقى Top 10 المتوقع أعلاه فرضية كود، والـ 40,200 والـ 6,560 بلا مالك مقاس.

## أول إصلاحين بعد ما يؤكد اللوج النمط — لا يُنفَّذان الآن

إذا ظهر إيقاع 8 ثوانٍ على dashboard: أول إصلاح هو إيقاف استطلاع بوابة الخدمة/النقل عند إخفاء التبويب ورفع الفترة، واستبدال سحب كل حركات المحفظة بملخص RPC.
إذا ظهر marketing/home بعدد مشاهدات كبير و hero_banners في Postgres logs: الإصلاح الثاني هو استعلام بانر واحد.
إذا ظهرت الأخطاء متلاحقة على نفس المسار بعد 5005ms: الإصلاح الثالث هو خفض إعادة المحاولة على CONNECT_TIMEOUT. هذا يوقف العاصفة بعد العطل ولا يفسّر الطلبات الناجحة.
Auth يُؤجَّل حتى يظهر User-Agent. لا يُغلق public-config قبل ذلك إلا إذا اللوج أظهر استخدام مفتاح anon من خارج التطبيق.
