# المرحلة 1 — تخفيف عاصفة طلبات Supabase
التاريخ: 2026-09-26

لم يُمس marketing/home ولا hero_banners. لم تُغيّر صلاحيات المستخدمين ولا شكل الواجهات. معادلة الرصيد بقيت: مجموع الإتمام الدائن ناقص مجموع الإتمام المدين.

## الملفات المعدلة

- public/assets/service-preview.js
  (قوس واحد ناقص في بطاقة الطلب كان يمنع المتصفح من تشغيل الملف كله. أُغلق القوس حول نفس شروط الأزرار حتى تعمل حلقة 30 ثانية.)
- public/assets/transport-preview.js
- public/services-provider.html
- public/assets/portal-framework/portal-notifications-ops.js
- public/assets/api.js
- apps/services/routes.js
- apps/wallet/routes.js
- apps/notifications/routes.js
- shared/utils/ledgerWallet.js
- shared/config/supabase.js
- shared/utils/stormProbe.js (جديد)
- shared/migration_ervenow_ledger_wallet_aggregate.sql (جديد — لم يُنفَّذ على قاعدة البيانات)
- server/server.js
- tests/unit/ledgerWallet.test.js

## السلوك قبل وبعد

1. مؤقت البوابة
- قبل: service-preview و transport-preview و services-provider كل 8 ثوانٍ، حتى والتبويب مخفي. services-provider كان مؤقتاً بلا إيقاف عند مغادرة الصفحة.
- بعد: مؤقت واحد لكل صفحة كل 30 ثانية. document.hidden يوقف المؤقت بالكامل. عند الرجوع إلى visible يُنفَّذ تحديث واحد ثم يُعاد المؤقت. pagehide أو stop() يلغي المؤقت. دورة جديدة لا تبدأ إذا كانت الدورة السابقة ما تزال تعمل.

2. رصيد لوحة الخدمة
- قبل: كل لوحة تسحب صفوف ervenow_ledger_transactions المكتملة كلها، ثم حتى 200 صف لحساب ربح اليوم.
- بعد: RPC واحد ervenow_ledger_wallet_aggregate يعيد available_balance و pending_balance و total_credits و total_debits و total_earned و total_commission و earned_today. لا يُنشئ محفظة. إذا لم تُنفَّذ الهجرة بعد، المسار الاحتياطي يستخدم amount.sum() و count، ولا يسحب الصفوف.
- /api/wallet/transactions بقي يُستدعى مع كل دورة ظاهرة لأن قائمة الواجهة ما زالت تحتاجه، بحد أعلى موجود مسبقاً، وليس بمسح كل السجل.

3. الإشعارات
- قبل: كل دورة تجلب حتى 100 صفاً لعدّ غير المقروء، ثم قائمة limit=40.
- بعد: unread-count يستخدم count(*) بلا صفوف. القائمة تُجلب عند فتح الصفحة أو فتح اللوحة، أو إذا تغيّر العدد واللوحة مفتوحة. بوابة السائق ما زالت تستخدم التحديث الكامل (المرحلة 2).
- العدّاد لم يعد مقصوصاً عند 100 ولم يعد يُصفّي بوابة الخدمة/النقل داخل العداد. القائمة المعروضة ما زالت تُصفّى كما كانت.

4. إعادة المحاولة عند انقطاع الاتصال
- قبل: الخادم حتى 5 محاولات، والمتصفح حتى 4، فيمكن أن تتضاعف إلى نحو 20 على نفس العملية.
- بعد: الخادم محاولتان كحد أقصى للقراءة وللطلبات التي تحمل Idempotency-Key، مع انتظار 400 ثم 800 مللي ثانية. الكتابة غير المتطابقة محاولة واحدة. المتصفح لا يعيد أخطاء الشبكة ولا 5xx، حتى لا يعيد ما أعاده الخادم.

5. العدادات
- تعمل فقط خارج production، أو إذا ضُبط ERVENOW_STORM_PROBE=1. ERVENOW_STORM_PROBE=0 يوقفها.
- الخادم يطبع [storm-probe] بعد كل لوحة، و GET /api/internal/storm-probe يعرض العدادات.
- على localhost يظهر window.__ERVENOW_STORM_PROBE__ لطلبات dashboard و wallet/transactions و notifications.
- لا تُضاف هذه الأرقام إلى JSON الذي تراه الواجهة.

## تقدير تبويب خدمة واحد

التبويب ظاهر الساعة كاملة:

- قبل: 450 دورة/ساعة. كل دورة 4 طلبات HTTP (لوحة + معاملات المحفظة + عدّ الإشعارات + قائمة الإشعارات) = 1800 طلب HTTP/ساعة. داخل اللوحة نحو 6 استعلامات، أحدها يسحب كل حركات المحفظة المكتملة، وآخر يسحب قائمة اليوم.
- بعد: 120 دورة/ساعة (خفض الدورات نحو 73%). كل دورة 3 طلبات HTTP (لوحة + معاملات المحفظة + العدّ فقط) = 360 طلب HTTP/ساعة. القائمة لا تُعاد كل دورة.
- بعد تنفيذ SQL: استعلامات اللوحة تصبح 4 (الملف، الطلبات، العمولة، RPC واحد).
- قبل تنفيذ SQL: نحو 12 استعلاماً مجمعاً/عداً، بلا تنزيل الصفوف.
- التبويب المخفي: كان 1800 طلب HTTP/ساعة لنفس الدورة. أصبح 0 لحلقة اللوحة.

حلقة الموقع كل 15 ثانية ما زالت تعمل على نفس الصفحتين، وهي خارج هذه المرحلة.

## مؤقت مكرر

لا يوجد مؤقت ثانٍ للوحة على service-preview أو transport-preview أو services-provider.

بقي مؤقت واحد مختلف: ErvenowPortalProviderLocation.startPresenceLoop كل 15 ثانية على بوابتي الخدمة والنقل. هذا موقع المزوّد، ومؤجل للمرحلة 2 مع hero_banners و admin/stats وموقع السائق.

## ما يلزم تشغيله يدوياً

نفّذ shared/migration_ervenow_ledger_wallet_aggregate.sql في Supabase حتى تصبح اللوحة استعلاماً واحداً. إلى أن يُنفَّذ، المسار الاحتياطي بالمجاميع يعمل ولا يعيد سحب كل الصفوف.

نسخة Vercel لا تتحدث إلا بعد npm run frontend:sync. لم يُشغَّل في هذه المرحلة.
api.js أصبح no-cache حتى يصل خفض إعادة المحاولة دون انتظار كاش 7 أيام.

اختبار tests/unit/ledgerWallet.test.js: 7 نجاحات. الرصيد المتوقع 85 و 0 و 80 بقي كما هو.
