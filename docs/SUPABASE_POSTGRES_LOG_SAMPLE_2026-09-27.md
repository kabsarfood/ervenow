# حكم عينة Postgres Logs

التاريخ: 2026-09-27
المصدر: 25 سطرًا لصقها المستخدم من سجلات Postgres لمشروع pnpcplpfktsujuhfpbny.
لم يُنفَّذ إصلاح ولا migration ولا تغيير polling.

## ما تغطيه العينة

ليست تجميع 24 ساعة. هي أحدث 25 حدثًا، وتمتد تقريبًا من 12:14 إلى 13:00 بتوقيت UTC+3 (نحو 46 دقيقة). هذا بعد انتهاء عدّ القراءة الذي أُلغي سابقًا، فهذه الأسطر ليست ذلك الاستعلام.

## الأعداد داخل العينة

- أخطاء last_seen_at: 0
- أخطاء SQLSTATE 42703: 0
- أخطاء column does not exist: 0
- أخطاء ERROR: 16، وكلها النص نفسه: canceling statement due to statement timeout
- هذا النص هو SQLSTATE 57014، وليس 42703

## أكثر الرسائل تكرارًا

1. canceling statement due to statement timeout — 16 — ERROR
2. PID 174906 in cancel request did not match any process — 1 — LOG
3. PID 174893 in cancel request did not match any process — 1 — LOG
4. PID 174772 in cancel request did not match any process — 1 — LOG
5. PID 174760 in cancel request did not match any process — 1 — LOG
6. PID 174720 in cancel request did not match any process — 1 — LOG
7. duration عن pg_stat_statements (نحو 10.2 ثانية) — 1 — LOG
8. duration عن pg_database_size (نحو 10.4 ثانية) — 1 — LOG
9. duration عن max_connections من pg_settings (نحو 15.0 ثانية) — 1 — LOG
10. duration عن default_transaction_read_only (نحو 13.7 ثانية) — 1 — LOG

استعلامات المدة الأربعة هي قراءات منصة Supabase على جداول النظام، لا استعلامات طلبات ERVENOW. كلها أبطأ من 10 ثوانٍ.

## القرب من 4,687

لا. last_seen_at في هذه العينة = 0، بينما الرقم الظاهر في اللوحة 4,687. حتى مهلات الاستعلام هنا 16 سطرًا في 46 دقيقة، أي نحو 500 في اليوم إذا ثبت هذا المعدل. ذلك لا يغلق رقم 4,687، لأن العينة صفحة أخيرة وليست عدّاد اليوم كاملًا.

## التصنيف

NOT CONFIRMED

last_seen_at لا يمثل أغلب الأخطاء في ما وصل. في هذه النافذة الأخيرة الأخطاء كلها مهلة statement timeout. فرضية العمود الناقص لم تظهر في السجل المرئي الآن.

ما تثبته العينة: القاعدة تلغي استعلامات لتجاوز المهلة، وحتى قراءات كتالوج المنصة تأخذ 10–15 ثانية. هذا يوافق تنبيه Disk IO، ولا يوافق سيل 42703 من last_seen_at في هذه الدقائق.
