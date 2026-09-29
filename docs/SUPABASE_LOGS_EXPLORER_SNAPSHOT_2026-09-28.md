# لقطة Logs Explorer — 2026-09-28 09:02

تشخيص فقط. لم يُنفَّذ إصلاح ولا migration ولا deploy.

الصورة قائمة سجلات خام، وليست نتيجة:

select event_message, count(*) as n
from logs
where source = 'postgres_logs'
group by event_message
order by n desc
limit 10

## ما يظهر

- الشريط السفلي: Showing 100 of 138 rows
- الصفوف الظاهرة في الشبكة طلبات GET إلى /rest/v1/platform_settings
- عمود الحالة في هذه الصفوف: 200
- العمود الأيمن ما زال فاحص الأمان (Auth RLS Initialization Plan، Function Search Path Mutable، RLS Policy Always True)

138 سطرًا في هذا العرض ليست عدّاد أخطاء Postgres البالغ 268.

## ما لا يُحسب من هذه اللقطة

لا يوجد تجميع، لذلك لا عدد لـ:
- platform_feature_flags
- driver_notifications
- users.last_seen_at
- stores.file_url
- drivers.updated_at
- stores.profile_views
- statement timeout

لا يُستنتج من صفوف platform_settings الناجحة أن أخطاء 42703 اختفت من بطاقة Postgres.
