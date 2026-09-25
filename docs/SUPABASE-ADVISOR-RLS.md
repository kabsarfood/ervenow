# إغلاق تحذيرات Supabase Security Advisor

نُفّذ على القاعدة الحية في 2026-09-25 عبر `shared/migration_supabase_advisor_rls.sql`.

- `order_number_counters`: RLS مفعّل، وanon/authenticated مرفوضان.
- `stores`: RLS مفعّل، وanon/authenticated مرفوضان.
- `withdraw_requests`: العرض صار `security_invoker=true` بدل Security Definer.

الخادم يستخدم service_role فيتجاوز RLS. التحقق بعد التنفيذ: قراءة `stores` و`withdraw_requests` نجحت.

تنبيه Data API (2.84% من 563) منفصل: RLS المغلق لا يسبب فشل الطلبات، بل يكشف الجداول. المستشار قد يحتاج دقائق حتى يختفي التحذير.
