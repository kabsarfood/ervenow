# إنشاء العضوية — تدقيق وتنفيذ

التاريخ: 2026-09-25

## التدقيق

1. تصنيفات المتاجر
نشاط المتجر (سوبرماركت، صيدلية، ملابس…) هو stores.type. القائمة الافتراضية في shared/productCategoryTypes.js وshared/membershipCatalog.js. ليست صفوفاً في categories إلا بعد ترحيل scope=store ونوع market.

2. تصنيفات المطاعم
مطبخ المطعم في shared/restaurantCategories.js ويُحفظ في categories حيث type=restaurant وscope=store. عمود المتجر يبقى stores.category، ونوع المتجر restaurant.

3. النقل والخدمات
نوع مقدم الخدمة في users.service_type. القائمة التشغيلية في shared/utils/serviceProviderTypes.js. النقل ليس Login Role؛ pickup_truck وfurniture_move وinternal_delivery أنواع خدمة.

4. جدول categories
نعم، جدول مركزي: type + scope + slug + name_ar + icon + image_url + sort_order + is_active. الإدارة الحالية: /admin/categories وواجهتها admin-categories.html.

5. ما كان ثابتاً
صفحة /login لا تكتب القوائم داخل HTML؛ تجلب /api/core/membership-catalog. الاحتياط الثابت كان في membershipCatalog.js للمتجر والنقل والخدمات. المطاعم كانت تُدمج من قاعدة البيانات. روابط الواجهة العامة كانت /login?role=customer.

6. الترحيل المطلوب
لا جدول جديد. نفّذ shared/migration_membership_activities.sql بعد ترحيلات categories الحالية. يزرع أنشطة المتجر والنقل والخدمات في categories بنطاق store. لو فشل الجدول تبقى القوائم الاحتياطية.

7. الإضافة من الإدارة
من لوحة الأقسام اختر:
- متجر — نشاط التسجيل (market/store)
- مطاعم — تصنيف المتجر (restaurant/store)
- نقل — نشاط التسجيل (transport/store)
- خدمات — نشاط التسجيل (services/store)
بعد الحفظ يظهر الخيار في إنشاء العضوية لأن الكتالوج يدمج صفوف categories النشطة ويحذف المعطّل. لا دور أمني جديد: المتسوق فقط يُنشأ Customer فوراً. المتجر والمطعم طلب متجر، والمندوب والنقل والخدمات طلب اعتماد.

## ما نُفّذ

- الرقم الجديد بعد واتساب يرى «اختر نوع العضوية» ولا يُنشأ Customer إلا إذا اختار متسوق.
- روابط الدخول العامة أصبحت /login مع الإبقاء على next عند الحاجة. روابط المتجر والمندوب الخاصة بقيت كما هي.
- /join يفتح /login.
