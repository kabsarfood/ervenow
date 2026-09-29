# إصلاح select فقط: driver_notifications و platform_feature_flags

التاريخ: 2026-09-27
لم يُنفَّذ deploy. لم تُشغَّل migration. لم يُضَف عمود.

## ما تغيّر

1. apps/driver/retryNotifications.js السطر 14
   حُذف message من select.
   أصبح: id, driver_id, phone, attempts, status, created_at

2. shared/utils/platformFeatureFlags.js السطر 155
   داخل loadFinancialFeatureFlags فقط.
   حُذف config من select.
   أصبح: key, mode, updated_at
   العتبات تبقى من DEFAULT_AUTO_FREEZE_CONFIG: warn_threshold 50 و freeze_threshold 100.

## ما لم يتغير

- منطق واتساب، الفترة 60 ثانية، attempts، status.
- فترة استطلاع لوحة الإدارة.
- last_seen_at.
- updateFinancialFeatureFlag ما زال يطلب config عند الحفظ فقط، وليس في قراءة الـ 15 ثانية. هذا المسار خارج نطاق هذا الإصلاح.

## التحقق

- node --check للملفين: نجح.
- require للملفين: نجح.
- jest tests/unit/platformFeatureFlags.test.js: 7 اختبارات نجحت.
- الخادم أقلع على المنفذ 4017 ووصل إلى ERVENOW RUNNING.
- GET /api/health رجع ok:true.
- تحذيرات TimeoutError عند الإقلاع من live map و site maintenance وفحص users.status. هذه استعلامات موجودة قبل التعديل، وليست من الملفين.
- أُوقف الخادم التجريبي بعد الفحص.
