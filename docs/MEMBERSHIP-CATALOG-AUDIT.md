# تدقيق تصنيفات إنشاء العضوية

التاريخ: 2026-09-25

1. تصنيفات المتاجر: ثابتة في `apps/store/routes.js` كـ `stores.type` (سوبرماركت، صيدلية، خضار…). ليست صفاً لكل نشاط في جدول مستقل.
2. تصنيفات المطاعم: `shared/restaurantCategories.js` ثم تُدمج مع جدول `categories` حيث `type=restaurant` و`scope=store`. القيمة تُحفظ في `stores.category` والمتجر يبقى `type=restaurant`.
3. النقل والخدمات: `users.service_type` وقوائم في `shared/utils/serviceProviderTypes.js` وخيارات التسجيل داخل login. ليست Login Role مستقلاً لكل نشاط.
4. جدول مركزي: `public.categories` موجود (slug, name_ar, icon, image_url, sort_order, is_active, type, scope). الإدارة تضيف عبر `POST /api/admin/categories`. القيد الحالي يسمح فقط بـ restaurant, market, pharmacy, services, transport, fuel, clothing.
5. ما هو ثابت في الكود: أنواع المتجر، أنواع خدمة المندوب/النقل، وأنواع العضوية الستة. صفحة `/login` لم تعد تحتوي البطاقات؛ تطلب `GET /api/core/membership-catalog`.
6. ما يحتاج Migration لاحقاً: توسيع `categories_type_check` إذا أردنا أن يضيف الأدمن «إلكترونيات» كنشاط متجر أو نوع خدمة جديد من اللوحة دون تعديل الكود. لم يُنفَّذ الآن لأن القيد الحالي يرفض type غير المعروف.
7. ما يظهر تلقائياً اليوم: أي تصنيف مطعم نشط يضيفه الأدمن في `categories` (type=restaurant, scope=store) يدخل قائمة «اختر نوع المطعم» بدون تعديل `/login`.

التنفيذ: رقم جديد بعد OTP يرى «اختر نوع العضوية». المتسوق يُنشأ Customer. المتجر والمطعم يكملان `/register-store` كطلب اعتماد. المندوب والنقل والخدمات يفتحون نموذج الانضمام الحالي ولا يُمنحون Role قبل الاعتماد. `/join` ورابط الواجهة الرئيسية أصبحا `/login`.
