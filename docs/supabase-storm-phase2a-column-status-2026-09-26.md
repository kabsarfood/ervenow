# حالة عمود last_seen_at
التاريخ: 2026-09-26

2B لم تبدأ. لم يُعاد الاتصال بقاعدة البيانات من هنا، ولم تُكرر محاولة ALTER.

## نتيجة التحقق

- العمود موجود: لا. فحص information_schema الذي نجح عندكم أعاد No rows returned. هذا يعني أن public.users لا يحتوي last_seen_at الآن.
- النبضة تعمل على العمود: لا يمكن تأكيد كتابة حقيقية، لأن العمود غير موجود. الكود جاهز: عند وجود العمود يكتب last_seen_at فقط. قبل ذلك يسقط إلى updated_at ويعيد persisted = updated_at.
- الإحداثيات لم تتغير من نبضة الحضور: نعم من جهة الكود. تحديث الحضور هو { last_seen_at } فقط. lat و lng يُكتبان في PATCH /api/services/me/location وهو مسار منفصل.
- آخر نشاط يظهر صحيح: الكود يقرأ last_seen_at ثم updated_at ثم created_at. قبل وجود العمود القيمة المعروضة تبقى updated_at أو created_at، لأن last_seen_at لا يصل من القاعدة.

2A مكتملة من جهة الكود. 2A غير مكتملة من جهة قاعدة البيانات إلى أن ينجح ALTER مرة واحدة.

## لماذا نجح الفحص وفشل الإضافة

SELECT على information_schema لا يقفل جدول users. ALTER TABLE يحتاج قفلاً على الجدول. انتهاء الاتصال بعد 5 ثوانٍ مع بقاء العمود غائباً يطابق انتظار قفل أو انقطاع الاتصال، وليس خطأ صياغة. إعادة المحاولة فوراً تعيد نفس الانتظار. شغّل العبارة مرة واحدة عندما يهدأ الضغط، ثم أعد فحص الأعمدة مرة واحدة.

## الملف

shared/migration_users_last_seen_at.sql يحتوي فقط:
- ALTER TABLE ... ADD COLUMN IF NOT EXISTS last_seen_at timestamptz
- COMMENT على العمود

لا INSERT ولا UPDATE ولا تعديل lat/lng. تشغيله مرتين بعد النجاح لا يضيف العمود مرة ثانية.

## SQL النهائي — مرة واحدة

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT اختياري بعد نجاح السطر السابق:

COMMENT ON COLUMN public.users.last_seen_at IS
  'آخر حضور للبوابة وهي ظاهرة. لا يعني أن الإحداثيات تغيّرت.';

## فحص واحد بعد النجاح

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name = 'last_seen_at';

المتوقع صف واحد: last_seen_at / timestamp with time zone.

ثم طلب حضور واحد من بوابة ظاهرة. الاستجابة المتوقعة:
persisted = last_seen_at
ولا يحتوي جسم التحديث على lat أو lng.

إذا بقيت الاستجابة persisted = updated_at فالعمود ما زال غير ظاهر لواجهة PostgREST، أو أن ALTER لم يُلتزم.
