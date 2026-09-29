# سبب الجذر: platform_feature_flags و driver_notifications

التاريخ: 2026-09-27
تشخيص فقط. لم يُنفَّذ إصلاح ولا migration.

السجل لآخر 24 ساعة: platform_feature_flags 3050، driver_notifications 1542.
نص السجل يبدأ بـ column ثم اسم الجدول، فهذا خطأ عمود (42703) والجدول نفسه موجود. لو كان الجدول غائبًا لبدأ السطر بـ relation.

## 1) platform_feature_flags

الملف: shared/utils/platformFeatureFlags.js
الدالة: loadFinancialFeatureFlags
من يستدعيها على المؤقت:
- GET /api/admin/features عبر listFinancialFeatureFlagsArray في apps/admin/routes.js
- الواجهة: loadFinancialFeatureFlags في public/admin-dashboard.html
- بالإضافة، نفس الدالة تُستدعى من GET /api/admin/drivers عبر loadAutoFreezeSettings، ومن GET /api/admin/finance-summary بعد نجاح RPC الملخص وبفاصل كاش 90 ثانية

الاستعلام الذي يفشل:

select key, mode, config, updated_at
from platform_feature_flags
where key in (auto_freeze, auto_payout, financial_alerts, finance_charts, withdraw_system)

المخطط الأساسي في shared/migration_platform_feature_flags.sql:
key, mode, updated_at
لا يوجد config.

المخطط اللاحق في shared/migration_platform_feature_flags_config.sql يضيف:
config jsonb not null default '{}'

العمود الغائب هو config. الأعمدة الثلاثة الأخرى موجودة في إنشاء الجدول. رسالة السجل column platform_feature_fla… تطابق column platform_feature_flags.config does not exist.

لماذا كل 15 ثانية:
public/admin-dashboard.html يضبط LEDGER_TX_POLL_MS = 15000.
المؤقت يستدعي loadFinancialFeatureFlags ثم loadLedgerFinanceSummary لكل من لديه صلاحية finance.
لا يتوقف عند إخفاء التبويب.
GET /features بلا كاش: كل ضربة تنفّذ select الفاشل مرة واحدة.

الحساب:
86400 / 15 = 5760 استدعاء في 24 ساعة إذا بقي التبويب مفتوحًا طوال اليوم.
3050 / 5760 = 12.7 ساعة من هذا المؤقت وحده.
هذا يكفي لتفسير 3050 بدون أي مسار آخر.

مسارات إضافية تكتب في نفس عداد الخطأ إن كانت الصفحة مفتوحة:
- GET /drivers كل 30 ثانية: 2880 في اليوم الكامل، لأن enrichDriversWithAutoFreeze يقرأ الأعلام قبل أن يقرر أن التجميد التلقائي مطفأ.
- finance-summary: العميل كل 15 ثانية، لكن قراءة الأعلام على الخادم كل 90 ثانية وفقط إذا نجح RPC الملخص: 960 في اليوم الكامل.

إذا عملت هذه المسارات مع مؤقت الـ 15 ثانية، ساعات فتح التبويب تكون أقل من 12.7 حتى يبقى المجموع 3050. لا يوجد في الكود ما يضاعف الاستعلام الواحد إلى عدة أخطاء.

fallback:
نعم، داخل التطبيق فقط. isMissingFeatureFlagsTable يطابق أي does not exist، فيرجع القيم الافتراضية في الذاكرة ولا يعيد select أقصر.
لا محاولة SQL ثانية. الخطأ يُسجَّل في Postgres مرة ثم يُبتلع.

HTTP:
GET /api/admin/features يرجع 200 وقائمة الافتراضيات (auto_freeze=2 وغيرها).
الواجهة تفحص Array.isArray فقط، فترسم المفاتيح ولا تعرض فشل القاعدة.
رسالة «نفّذ migration» لا تظهر في هذا المسار لأن الاستثناء لا يصل إلى المتصفح.

هل config مستخدم؟
نعم وظيفيًا: عتبات التجميد التلقائي warn_threshold و freeze_threshold.
عند غياب العمود تُستخدم الافتراضيات 50 و 100 أصلًا. السلوك الحالي للمنصة هو هذه الافتراضيات، لا قيمة محفوظة في القاعدة.

التصنيف: MISSING MIGRATION
جدول الأساس موجود. ملف إضافة config موجود في المستودع ولم يُطبَّق. الكود يطلب العمود.

الاختيار المقترح: A الآن.
احذف config من select واترك الافتراضيات. هذا يوقف الـ 3050 من غير عمود جديد، ويُبقي السلوك الظاهر اليوم.
B (تشغيل migration_platform_feature_flags_config.sql) له معنى فقط إذا أردتم حفظ عتبات مختلفة عن 50 و 100. ليس مطلوبًا لإيقاف الخطأ ولا لتسيير التجميد التلقائي على القيم الحالية.

## 2) driver_notifications

الملف: apps/driver/retryNotifications.js
الدالة: retryFailedNotifications
التشغيل: startRetryNotificationsWorker من server/server.js
ليس endpoint. عامل داخل عملية الخادم.

select الكامل:

select id, driver_id, phone, message, attempts, status, created_at
from driver_notifications
where status = failed and attempts < 3
order by created_at
limit 10

مخطط shared/migration_driver_notifications.sql:
id, order_id, driver_id, phone, channel, status, error, attempts, sent_at, created_at

message غير موجود في هذا الملف ولا في أي ملف SQL آخر في المستودع.
الأعمدة الأخرى في الـ select موجودة. أول عمود ناقص في القائمة هو message، لذلك السطر column driver_notifications… هو column driver_notifications.message does not exist.

message لا يُكتب عند إدراج الإشعار في apps/driver/notify.js.
العامل لا يقرأ الرسالة حتى لو وُجدت: نص واتساب ثابت «لديك طلب جديد (إعادة إرسال)».
العمود ليس له استخدام وظيفي في الكود الحالي.

هل يعمل كل 60 ثانية دائمًا؟
نعم، طالما عملية الخادم تعمل، حتى لو لم توجد إشعارات فاشلة.
فشل هذا الـ select لا يفعّل إيقاف backgroundPause. الإيقاف فقط بعد مهلة timeout.
الدقيقة التالية تعيد نفس الاستعلام بلا تغيير.

بعد الفشل:
يُطبع الخطأ، ثم return.
لا تحديث لصفوف، لا select بديل بلا message، لا HTTP.
الواجهة لا ترى هذا المسار.

الحساب:
86400 / 60 = 1440 في اليوم لعملية واحدة.
المرصود 1542.
الفرق 102، أي حوالي 7%. هذا عملية واحدة طوال اليوم مع إعادة تشغيل قصيرة أو تداخل قصير، لا نسختان طوال اليوم (النسختان كانتا ستعطيان نحو 2880).

التصنيف: OLD CODE
الكود يطلب عمودًا لم يكن في المخطط أبدًا ولا يُستخدم.

الاختيار المقترح: A فقط.
احذف message من select. لا تُضف العمود.

## خطة الأولوية (بلا تنفيذ)

1. driver_notifications — تعديل select وحذف message.
   أثر متوقع: إيقاف نحو 1440–1542 خطأ في اليوم من عامل يعمل بلا زائر.
   لا migration.

2. platform_feature_flags — تعديل select إلى key, mode, updated_at والإبقاء على افتراضيات 50 و 100.
   أثر متوقع: إيقاف نحو 3050 خطأ في اليوم ما دام تبويب الإدارة بصلاحية finance مفتوحًا.
   لا migration في هذه الخطوة.

3. لا تُشغَّل migration_platform_feature_flags_config.sql إلا بقرار لاحق لحفظ عتبات التجميد في القاعدة. العمود له معنى، لكن غيابه لا يغيّر السلوك الحالي لأن الافتراضيات مستخدمة أصلًا.

4. مؤقت الـ 15 ثانية يبقى مصدر تكرار. بعد إصلاح العمود لن يولّد خطأ 42703. تخفيفه مسألة منفصلة وليست سبب هذه الأخطاء.
