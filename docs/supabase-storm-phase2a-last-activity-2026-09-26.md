# إقفال 2A — آخر نشاط في الإدارة
التاريخ: 2026-09-26

2B لم تبدأ.

## ما تغيّر

عرض «آخر نشاط» صار: last_seen_at ثم updated_at ثم created_at.
لم يُضف شرط انقطاع. لم تتغير مطابقة الطلبات ولا حالة online/offline.
POST /api/services/me/presence ما زال يكتب last_seen_at فقط، بلا lat و lng.

الأماكن:
- مزودو الخدمة والنقل في لوحة الإدارة: سطر آخر نشاط جديد من نفس الحقول.
- اعتماد التسجيلات: last_activity_at يُحسب بنفس الترتيب.
- العملاء، المتاجر، المناديب: نفس الترتيب في النص الظاهر.
- قائمة المناديب تنسخ last_seen_at من حساب users المرتبط بالجوال، بدون تغيير حالة المندوب.

إذا لم يُنفَّذ عمود last_seen_at بعد، الاستعلامات تتراجع إلى updated_at ويبقى العرض كما كان.

## الملفات

- shared/utils/lastActivityAt.js
- shared/services/registrationApprovals.js
- apps/admin/routes.js
- public/admin/modules/services.js
- public/admin/modules/transport.js
- public/admin/modules/panels.js
- public/admin/modules/drivers.js
- tests/unit/lastActivityAt.test.js

## اختبار

tests/unit/lastActivityAt.test.js و tests/unit/providerPresence.test.js: 7 نجاحات.
الحضور يفضّل last_seen_at. الحقل الفارغ يرجع إلى updated_at ثم created_at.

## ما يبقى يدوياً

شغّل shared/migration_users_last_seen_at.sql في Supabase إن لم يكن نُفِّذ. بعدها نبض الحضور يملأ last_seen_at والإدارة تعرضه.

2A مقفلة من جهة الكود. 2B لا تبدأ إلا بعد اعتمادك.
