# نشر إصلاح select فقط

التاريخ: 2026-09-27
لم يُنفَّذ تعديل إضافي، ولا migration، ولا ALTER، ولا RLS.

الالتزام: 6652aa9384c948ad02b40c090e66dde72f01db1d
الرسالة: Stop selecting columns that are not in the database.
الملفان فقط:
- apps/driver/retryNotifications.js
- shared/utils/platformFeatureFlags.js
الدفع: origin/main (673fcb9..6652aa9)

الأوقات بتوقيت +03:
- بدء نشر Railway: 13:58:38
- نجاح خدمة ERVENOW: 14:01:08
- نجاح آخر خدمة من الأربع: 14:02:57
- GET https://ervenow.com/api/health : 200 خلال 842 مللي ثانية عند 14:03:44

نافذة مراقبة Postgres Logs تبدأ من 14:01:08 +03.
المتوقع بعدها: لا أخطاء 42703 جديدة من config أو message.
