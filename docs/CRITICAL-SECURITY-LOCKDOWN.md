# إغلاق الثغرات الحرجة

نُفّذ في 2026-09-25 عبر `shared/migration_critical_security_lockdown.sql`.
لم تُمس تحذيرات search_path ولا جداول food/delivery/legacy.

## النتيجة

البند | قبل | بعد | الاختبار | النتيجة
دوال السحب والرصيد والشحن ورقم الطلب | anon و authenticated ينفّذانها | service_role فقط | نداء السيرفر نجح، وanon رُفض | نجح
orders | anon يقرأ ويكتب | لا سياسة عامة ولا GRANT | anon: permission denied، والسيرفر يقرأ | نجح
users | anon يقرأ ويدرج | سُحبت السياسات العامة والصلاحيات | anon: permission denied، والسيرفر يقرأ | نجح
سجل تجاري cr | 14 ملفاً في الدلو العام | 14 في `store-registration-documents` الخاص، والعام لم يبقَ فيه cr | النسخ اكتمل ثم حُذفت النسخة العامة | نجح
شعار وبنر ومنتجات | دلو عام | بقيت في `erwenow-store-registrations` العام | الصفحة الرئيسية فتحت | نجح

لوحة Security Advisor لا تُقرأ من هنا. بعد Refresh يُتوقع بقاء تحذير الدلو العام لأن الشعارات ما زالت عامة، مع انخفاض تحذيرات الدوال الستة وجدولي orders و users.

مراجعة لاحقة بلا تنفيذ: `ervenow_redeem_topup_code` يأخذ user_id من المستدعي، و`store_wallet_credit_for_order` تحتاج تأكيد عدم تكرار الزيادة لنفس الطلب.
