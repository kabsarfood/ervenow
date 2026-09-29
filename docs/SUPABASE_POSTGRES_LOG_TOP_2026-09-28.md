# أعلى مجموعات Postgres Logs — 2026-09-28 10:36

تشخيص فقط. الفترة في اللقطة: Last 24 hours.
الاستعلام نجح. رأس النتيجة: Results (12).
عمود العدد n غير ظاهر في الصورة لأن نص event_message يغطي العرض.

ترتيب الصفوف من الأكبر إلى الأصغر كما ظهرت:

1. canceling statement due to statement timeout
2. could not serialize data from client connection reset by peer
3. column driver_notifications.message does not exist
4. connection to client lost
5. could not send data to client: Broken pipe
6. canceling statement due to user request
7. PID 172076 in cancel request did not match any process
8. duration plan لـ SET على information_schema.columns
9. duration plan لطلب إلغاء PID 172098
10. duration plan لـ supabase_storage_admin.get_auth

غير ظاهرة داخل هذه النتيجة:
- platform_feature_flags
- users.last_seen_at
- stores.file_url
- drivers.updated_at
- stores.profile_views

driver_notifications.message ما زال داخل النافذة.
هذه النافذة تبدأ قبل اكتمال النشر (2026-09-27 14:01 +03)، لذلك هذا السطر قد يكون من الساعات التي سبقت النشر.

لا أرقام للعدّ لأن عمود n مقطوع.
صفوف duration هي خطط بطيئة (LOG) وليست بالضرورة داخل عدّاد أخطاء 268.
