# تدقيق المهلات وانقطاع الاتصال — 2026-09-28

تشخيص فقط. لم يُغيَّر timeout ولا polling ولا schema ولا أي ملف تشغيل.

نقطة البداية من البحث اليدوي بعد النشر:
- driver_notifications.message: No results
- platform_feature_flags: No results
- last_seen_at: No results

الرسائل المسيطرة:
- canceling statement due to statement timeout
- connection reset by peer
- connection to client lost
- Broken pipe
- cancel request did not match any process

لقطة Results السابقة أظهرت أيضاً: canceling statement due to user request، وخطط duration على information_schema.columns و supabase_storage_admin.get_auth.

## كيف تُقرأ الرسائل

رسالتان مختلفتان، وليستا سبباً واحداً.

1. canceling statement due to statement timeout
   Postgres ألغى الاستعلام لأن statement_timeout على الدور انتهى.
   خادم ERVENOW لا يضبط statement_timeout في أي مسار يعمل.
   الظهور الوحيد في المستودع هو scripts/run-migration-users-last-seen-at.js وهو ليس عملية التشغيل.

2. باقي الرسائل سلسلة واحدة لقطع الاتصال من جهة العميل:
   AbortSignal يغلق HTTP.
   PostgREST يرسل إلغاءً: canceling statement due to user request.
   إن وصل الإلغاء بعد انتهاء العملية: PID in cancel request did not match any process.
   أثناء إرسال النتيجة إلى مقبس مغلق: Broken pipe، connection to client lost، connection reset by peer.

## 1. مهلة عميل Supabase

الملف: shared/config/supabase.js
الدالة: applyReadTimeout داخل wrapFetchWithRetry
تُركَّب على كل عميل من createServiceClient و createUserClient.

- تطبق على GET و HEAD و OPTIONS فقط.
- الكتابة (POST و PATCH و DELETE و rpc) بلا هذه المهلة.
- القيمة: 8 ثوانٍ إذا لم يُضبط SUPABASE_READ_TIMEOUT_MS.
  الحد الأدنى 1 ثانية والأعلى 20 ثانية.
  قيمة المتغير على Railway غير معروفة من هذا الفحص.
- عند TimeoutError أو AbortError: تُرمى فوراً، بلا إعادة محاولة.
- عند ECONNRESET أو fetch failed: حتى محاولتين، بانتظار 400ms ثم 800ms.
- إغلاق GET بعد المهلة هو ما ينتج Broken pipe وإلغاء الطلب ورسالة PID.

التصنيف: A ثم E.

## 2. AbortController و Promise.race في عملية التشغيل

في عملية الخادم الحية لا يوجد إلا AbortSignal.timeout أعلاه.
Promise.race موجود في shared/utils/redisCache.js و queues/deliveryQueue.js لـ Redis والطابور، وليس لـ Postgres.
AbortController في scripts/ وفي public/assets/api.js هو مهلة المتصفح نحو Express، وليست مهلة Postgres.

لوحة الإدارة في public/admin-dashboard.html تضبط مهلة المتصفح على 30 ثانية.
مهلة الخادم نحو Supabase للقراءة 8 ثوانٍ، فتُلغى قراءة القاعدة والمتصفح ما زال ينتظر.
المتصفح لا يعيد الطلب: MAX_IDEMPOTENT_HTTP_RETRIES = 0.

## 3. liveMapPublicStore

الملف: shared/utils/liveMapPublicStore.js
الدالة: refreshFromDatabase
الاستعلام عبر readPlatformSetting:
  select value from platform_settings where key = live_map_public_enabled
مهلة العميل: 8 ثوانٍ (GET).
التكرار: setInterval كل 45 ثانية، ويبدأ فوراً عند تحميل الوحدة.
ذاكرة platformSettingsCache: 180 ثانية، فالقراءة الفعلية أقرب إلى مرة كل 3 دقائق لكل عملية.
الكتابة upsert بلا مهلة العميل.
الاستعلام مفتاح واحد. إن انتهى بالـ timeout فالبطء في الاتصال لا في حجم الاستعلام.
بعد مهلتين متتاليتين: إيقاف دقيقتين (backgroundPause).
لا إعادة للاستعلام بعد timeout.
التصنيف عند الفشل: D، والأثر في السجل: E.

## 4. siteMaintenanceStore

الملف: shared/utils/siteMaintenanceStore.js
الدالة: refreshFromDatabase
الاستعلام: select value from platform_settings where key = site_maintenance_enabled
نفس المهلة 8 ثوانٍ، نفس 45 ثانية، نفس ذاكرة 180 ثانية، نفس الإيقاف بعد مهلتين.
تُحمَّل الوحدة من shared/middleware/siteMaintenanceGate.js عند إقلاع server.js، فأول قراءة تحدث مع الإقلاع.
التصنيف: D ثم E.

## 5. retryNotifications

الملف: apps/driver/retryNotifications.js
الدالة: retryFailedNotifications
الاستعلام:
  select id, driver_id, phone, attempts, status, created_at
  from driver_notifications
  where status = failed and attempts < 3
  order by created_at limit 10
مهلة العميل: 8 ثوانٍ.
التكرار: كل 60 ثانية. أول تنفيذ بعد 60 ثانية من الإقلاع، لا عند الثانية صفر.
حد 10 صفوف. الاستعلام خفيف.
timeout يُرمى ويوقف العامل دقيقتين بعد مرتين. لا إعادة لنفس القراءة.
التحديثات كتابة بلا مهلة العميل.
التصنيف: D إن فشل، ثم E. ليس مصدراً مستمراً ما دام الاتصال سليماً.

## 6. gasRadiusExpand

الملف: apps/delivery/gasRadiusExpand.js
الدالة: runGasRadiusExpansionTick
الاستعلام:
  select محدد من orders
  where service_type = gas_delivery
    and delivery_status in (new, pending)
    and provider_id is null
  order by created_at limit 40
مهلة العميل: 8 ثوانٍ.
التكرار: كل 60 ثانية. إن لم يوجد صفوف: توقف 3 دقائق.
التحديث كتابة بلا مهلة العميل.
الحجم محدود. timeout يعني بطء اتصال أو فهرس ضعيف على هذا الفلتر، لا مسحاً كاملاً مقصوداً.
التصنيف: D، ومع بطء الفلتر B خفيف. الأثر: E.

## 7. purgeClosedOrders

الملف: apps/delivery/purgeClosedOrders.js
الدالة: purgeClosedOrdersOlderThanOneYear
الاستعلام:
  select id, order_number, delivery_status, updated_at, created_at
  from orders
  where delivery_status in (delivered, completed, cancelled, canceled)
    and updated_at < cutoff
  order by updated_at limit 100
ثم delete where id in (...)
مهلة العميل على select فقط: 8 ثوانٍ. الحذف بلاها.
التكرار: أول مرة بعد 60 ثانية من الإقلاع، ثم كل 24 ساعة.
يمكن أن يتكرر على دفعات حتى تفرغ النتيجة.
هذا أثقل من عمال الدقيقة، لكنه نادر. لا يفسر تيار المهلات المستمر.
التصنيف المحتمل عند الفشل: B ثم A ثم E.

## 8. admin stats

الملف: apps/admin/routes.js
الدالة: computeAdminDashboardStats عبر GET /api/admin/stats
ذاكرة الخادم: 90 ثانية لكل range.
المتصفح: public/admin-dashboard.html كل 30 ثانية (STATS_POLL_MS)، بلا إيقاف عند إخفاء التبويب.

في كل تفويت للذاكرة، بالتوازي:
- count exact لطلبات اليوم
- count exact للطلبات النشطة
- count exact لكل الطلبات
- صفحات كل صفوف orders حتى 1000 صف في الصفحة، وسقف 80 صفحة، بأعمدة المبالغ والحالة
- صفحات created_at لنطاق الرسم

كل select هو GET، فمهلة 8 ثوانٍ على كل صفحة.
هذا أثقل استعلام متكرر في التطبيق.
إن تجاوزت الصفحة 8 ثوانٍ: إلغاء عميل وسلسلة الانقطاع.
إن تجاوزت statement_timeout قبلها: رسالة statement timeout.
لا إعادة على الخادم بعد الفشل. الطلب التالي من المتصفح بعد 30 ثانية، والذاكرة تمنع إعادة الحساب قبل 90 ثانية.
التصنيف: B و A و E، والتكرار C يضاعفها.

ملخص المالية المجاور:
الملف: shared/utils/ledgerWallet.js
الدالة: getAdminFinanceSummaryFromLedger
الاستدعاء: rpc ervenow_ledger_finance_summary
أربع عمليات SUM على ervenow_ledger_transactions مع join على المحافظ، ثم قراءة آخر 20 حركة وتنبيهات.
rpc كتابة/POST، فلا يشمله إلغاء الثواني الثماني.
ما زال قابلاً لـ statement_timeout.
المتصفح يستدعيه كل 15 ثانية. ذاكرة الخادم 90 ثانية.
التصنيف: B لرسالة statement timeout فقط. ليس مصدر Broken pipe.

## 9. information_schema

لا يوجد استعلام information_schema في server.js ولا في العمال ولا في مسارات API.
الاستعلامات موجودة في ملفات SQL و scripts لا تشغّلها عملية Railway.
سطر duration على information_schema.columns و supabase_storage_admin.get_auth في اللقطة السابقة هو عمل لوحة Supabase أو Storage، لا كود ERVENOW.
هذه الأسطر تفسر جزءاً من المهلات البطيئة، ولا تُنسب إلى إقلاع التطبيق.

## 10. وقت الإقلاع

عند تحميل server.js، قبل listen:
- siteMaintenanceStore.refreshFromDatabase فوراً: مفتاح واحد.
- liveMapPublicStore.refreshFromDatabase فوراً عند تحميل مسارات core و admin: مفتاح واحد. الوحدة تُحمَّل مرة واحدة.
- assertRequiredSchema: select id, status from users limit 1.

بعد listen:
- retry و gas: أول مرة بعد 60 ثانية.
- purge: أول مرة بعد 60 ثانية ثم كل يوم.
- GET /api/health لا يلمس Postgres.
- GET /api/health/full يقرأ users limit 1، وهو ليس مسار فحص Railway.

استعلامات الإقلاع خفيفة. TimeoutError عليها يعني D لا B.
لا تُنتج تياراً مستمراً إلا عبر setInterval بعد الإقلاع.

تعدد العمليات: railway.toml يشغّل npm start. أربعة خدمات نُشرت بنفس المستودع. إن شغّلت أكثر من خدمة نفس server.js، كل عامل أعلاه يتكرر بعدد العمليات. هذا مضاعف، وليس ثابتاً من السجلات.

## التصنيف

A) مهلة العميل 8 ثوانٍ على كل قراءة GET. موجودة وواحدة لكل عملاء Supabase.
B) استعلام ثقيل: إحصاءات الأدمن (مسح orders) ثم دالة ملخص المالية. التطهير اليومي أثقل لكنه نادر.
C) التكرار يضاعف A و B أثناء فتح لوحة الإدارة. عمال 45 و 60 ثانية استعلاماتهم صغيرة.
D) بطء الاتصال أو القرص يجعل الاستعلام الخفيف يتجاوز المهلة. متوافق مع تنبيه Disk IO السابق ومع timeout على صف واحد عند الإقلاع.
E) Broken pipe و reset و connection lost و cancel did not match أثر جانبي لإغلاق GET، لا أعطال منفصلة.

## أعلى 5 أسباب حسب الدليل

1. إغلاق قراءة Supabase بعد 8 ثوانٍ.
   الدليل الأقوى: أربع من الرسائل المسيطرة هي أثر قطع المقبس، والكود الوحيد الذي يغلقه هو applyReadTimeout.
   A ثم E.

2. statement_timeout داخل Postgres على الاستعلام الثقيل، وأثقلها إحصاءات الأدمن.
   الدليل: نص الرسالة مختلف عن إلغاء العميل، والتطبيق لا يضبط هذا الحد، ومسار /api/admin/stats يسحب جدول orders على صفحات.
   B، ويتحول إلى A و E إذا سبقته مهلة العميل.

3. بطء مسار الاتصال أو القرص، فيفشل حتى المفتاح الواحد وصف users الواحد.
   الدليل: فحوصات الإقلاع الخفيفة سجلت timeout سابقاً، وخطط information_schema و get_auth البطيئة ليست من التطبيق.
   D.

4. تكرار لوحة الإدارة: الإحصاءات كل 30 ثانية مع حساب كل 90 ثانية، وملخص المالية كل 15 ثانية مع حساب كل 90 ثانية.
   الدليل: المؤقتات في admin-dashboard.html بلا إيقاف عند إخفاء الصفحة.
   C يضاعف 1 و 2. ليس سبباً مستقلاً عنهما.

5. عمال الخلفية (إعدادات المنصة، إعادة الإشعار، توسيع الغاز، التطهير) لا تفسر التيار وحدها.
   استعلاماتها محدودة أو نادرة. تصبح ظاهرة فقط إذا كان المسار بطيئاً، أو إذا تكررت العملية بعدد خدمات Railway التي تشغّل server.js.
   D مع مضاعف C ضعيف.
