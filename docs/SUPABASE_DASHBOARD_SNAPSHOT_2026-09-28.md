# لقطة لوحة Supabase — 2026-09-28 08:47

تشخيص فقط. لم يُنفَّذ إصلاح ولا migration ولا deploy.

الصورة هي الصفحة الرئيسية لمشروع ervenow platform، الفترة Last 24 hours. ليست نتيجة استعلام Logs Explorer.

## ما تؤكده اللقطة

- الحالة: Healthy
- Total Requests: 2,969
- Success Rate: 85.9%
- API Gateway: 2,503
- Postgres: 396 طلبًا في بطاقة الخدمة
- Storage: 48
- Realtime: 22
- Advisor في وسط الصفحة: لا مشاكل ظاهرة في ذلك الصندوق

بطاقة Postgres تعرض 396 طلبًا. رقم 268 الذي أُرسل سابقًا هو أخطاء هذه البطاقة، وليس مجموع أسطر السجل، ولا يظهر كجدول في هذه الصورة.

## ما لا تحتويه اللقطة

العمود الأيمن قائمة متكررة بعناوين فاحص الأمان (Auth RLS Initialization Plan، Function Search Path Mutable، RLS Policy Always True). هذه ليست رسائل PostgreSQL ERROR من نوع column does not exist.

غير ظاهر في الصورة، ولذلك لا يُحسب:
- platform_feature_flags
- driver_notifications
- users.last_seen_at
- stores.file_url
- drivers.updated_at
- stores.profile_views
- statement timeout
- ترتيب أسباب الـ 268

## الاستعلام المطلوب

Logs → Logs Explorer، نفس الفترة Last 24 hours:

select event_message, count(*) as n
from logs
where source = 'postgres_logs'
group by event_message
order by n desc
limit 10
