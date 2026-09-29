# ترتيب أخطاء Postgres — آخر 24 ساعة

التاريخ: 2026-09-27
المصدر: استعلام Logs Explorer على `postgres_logs`، المدى Last 24 hours، Results (10).
الصفوف 8–10 تحت حافة الصورة، وكل واحد منها أقل من 37 لأن الترتيب تنازلي.
فلتر Severity ما زال على 2. الأرقام أدناه هي ما ظهر رغم ذلك.
لم يُنفَّذ إصلاح.

## الأعداد الظاهرة

| الترتيب | الرسالة (مقطوعة في الشاشة) | العدد |
|---:|---|---:|
| 1 | column platform_feature_fla… | 3050 |
| 2 | column driver_notifications | 1542 |
| 3 | column users.last_seen_at d… | 558 |
| 4 | column stores.file_url does… | 286 |
| 5 | column drivers.updated_at d… | 143 |
| 6 | canceling statement due to… | 101 |
| 7 | column stores.profile_views | 37 |

مجموع الظاهر: 5717 سطر سجل. لوحة Supabase كانت 4687 PostgreSQL Errors. العدّان ليسا نفس العداد (سطر سجل مقابل طلب)، والترتيب داخل هذه العينة يكفي للحكم.

- last_seen_at = 558. هذا 12% من 4687، و 10% من مجموع الصفوف الظاهرة.
- أخطاء «column … does not exist» هي الغالب. المهلة 101 سطرًا فقط.

## التصنيف

NOT CONFIRMED لكون last_seen_at المصدر الرئيسي.

هو خطأ حقيقي وثالث في الترتيب، وليس الأغلب.

## ماذا يطابق الكود

1. platform_feature_flags — 3050. `loadFinancialFeatureFlags` يختار `key, mode, config, updated_at` في كل قراءة. لوحة الإدارة تستدعي الميزات كل 15 ثانية بلا إيقاف عند إخفاء التبويب. 15 ثانية × نحو 13 ساعة ≈ 3050. عمود `config` مضاف في ملف هجرة منفصل عن إنشاء الجدول. الفشل يُبلع في التطبيق بعد ما يُسجَّل في Postgres، لذلك اللوحة لا تظهر مكسورة والعداد يزيد.

2. driver_notifications — 1542. العامل `retryNotifications.js` يعمل كل 60 ثانية ويختار العمود `message`. جدول `shared/migration_driver_notifications.sql` لا يعرّف عمود `message`. 60 ثانية × 24 ساعة = 1440، والفرق إلى 1542 استدعاءات إضافية قليلة. هذا أقرب تطابق عددي في العينة.

3. users.last_seen_at — 558. النبضة وقائمة المناديب ما زالتا تكتبان أو تقرأان العمود قبل التراجع. الحجم أصغر من البندين أعلاه في هذه النافذة.

4. stores.file_url 286، drivers.updated_at 143، stores.profile_views 37. أعمدة ناقصة أخرى، حجمها أضعف.

5. statement timeout — 101. موجود، وليس هو الـ 4687.

## الحكم

أخطاء PostgreSQL في هذه النافذة عائلة أعمدة غير موجودة (42703)، يتصدرها `platform_feature_flags` ثم `driver_notifications`. `last_seen_at` جزء أصغر. مهلة الاستعلام وتنبيه Disk IO يبقيان مشكلة منفصلة بحجم أصغر في هذا التجميع.
