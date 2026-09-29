# Audit نهائي — store-dashboard مقابل merchant-dashboard — 2026-09-29

لا حذف. لا Redirect كامل. لا تغيير API/RLS/schema.
المرجع الرسمي: `/merchant-dashboard`.

النتيجة: **B — Replaceable After Small Gaps**

---

## Function Matrix

الميزة | store-dashboard | مكانها في merchant-dashboard | مكافئة بالكامل؟ | الملاحظات
بيانات المتجر (قراءة) | نعم my-store | #home / #store | نعم | نفس المصدر
الاسم | عرض فقط | #store عرض فقط | نعم | لا نموذج تعديل للاسم في أي منهما
الوصف / النبذة | نعم hub.bio | #store mpHubBio | نعم | PATCH merchant-hub
الشعار | رفع + معاينة هيرو | #store رفع + معاينة | نعم | logo_base64
الغلاف | رفع banner | #store غلاف | نعم | banner_base64
الفئة | عرض في الهيرو | #store اختيار فئة + حفظ hub | Portal أوسع | legacy لا يغيّر الفئة من النموذج
الموقع / إحداثيات | نعم PATCH location | #store نفس الـ endpoint | نعم وظيفياً | GPS + maps_url أو lat,lng. Portal يقفل المحرر بعد الحفظ مع زر تعديل. لصق الحافظة فقط في legacy
خريطة Leaflet لاختيار الموقع | لا (CSS live-store-map موصول بلا JS خريطة) | لا | نعم | لا فجوة خريطة تفاعلية
merchant-hub | PATCH bio + دفع + شعار/غلاف | #store + #settings للدفع | نعم | الدفع في البوابة تحت الإعدادات
الأقسام (منتج) | قائمة category-options | #products + تبويب أقسام merchant-categories | Portal أوسع | CRUD أقسام التاجر في البوابة فقط
المنتجات قراءة | نعم limit 60 | #products limit 80 | نعم
إضافة / تعديل منتج | نعم | #products | جزئي | انظر المنتجات
حذف / إخفاء | DELETE | زر إخفاء DELETE + خانة متاح للبيع | نعم+ | البوابة تضيف active
الصور | رئيسية + حتى 5 إضافية | صورة واحدة | لا | images_base64 في legacy فقط
الأسعار / العروض | سعر + offer_price | نفس الحقول + تبويب عروض | نعم للعروض الأساسية
المحفظة رصيد | merchant-dashboard.wallet | #wallet | نعم
سجل حركات | حتى 8 | حتى 30 | نعم+
السحب قائمة | نعم status | #wallet تاريخ/مبلغ/حالة/سبب رفض/id | نعم+
طلب سحب | مبلغ ≥10 فقط | مبلغ ≥10 + آيبان إلزامي | أدق في البوابة | نفس POST withdrawals
reviews | GET limit 8 عرض | #reviews limit 20 | نعم | لا رد ولا فلتر في أي منهما
publish / readiness | غير موجود في الصفحة | #home شريط إكمال + POST publish | Portal أوسع
KPIs مشاهدات/تقييم/طلبات | نعم من dashboard | #home جزئياً | جزئي | profile_views غير معروض في البوابة
معاينة الزائر المضمّنة | بطاقة داخل الصفحة | رابط store.html?preview=1 | لا شكلاً / نعم وظيفة فتح الصفحة
تحديث المعاينة | زر يعيد my-store | إعادة فتح/حفظ أو رابط | UI فقط

---

## API Matrix

API | PortalShell؟ | Hash | نفس الصلاحيات؟
GET /api/store/my-store | نعم | boot كل الأقسام | نعم JWT store
GET /api/store/merchant-dashboard | نعم | boot، محفظة | نعم
GET /api/store/products | نعم | #products #pos | نعم (حد 80 مقابل 60)
POST/PUT /api/store/products | نعم | #products | نعم — جسم الحفظ في البوابة بلا sort_order/rating/images[]
DELETE /api/store/products/:id | نعم | #products إخفاء | نعم
GET /api/store/product-category-options | نعم | #products | نعم
PATCH /api/store/merchant-hub | نعم | #store #settings | نعم
PATCH /api/store/location | نعم | #store | نعم maps_url أو lat/lng
GET /api/store/withdrawals | نعم | #wallet | نعم
POST /api/store/withdrawals | نعم | #wallet | نعم — البوابة ترسل iban أيضاً
GET /api/store/reviews | نعم | #reviews | نعم limit أعلى
GET /api/core/checkout-payment-methods | نعم | #settings | نعم
GET /api/store/wallet | لا في أي منهما | — | الصفحة القديمة تستخدم wallet من merchant-dashboard
GET /api/store/publish-readiness و POST /api/store/publish | Portal فقط | #home | ليست في legacy

---

## الوظائف الفريدة في legacy

Business logic ما زال في store-dashboard.html فقط:
1. sort_order عند حفظ المنتج
2. حقل تقييم عرض المنتج (rating على المنتج)
3. رفع معرض صور (images_base64 حتى 6 مع الرئيسية)

UI legacy only (ليس مانع إغلاق منطقي):
- بطاقة معاينة زائر مضمّنة وهيرو الغلاف في نفس الصفحة
- زر لصق رابط Maps من الحافظة
- KPI مشاهدات الصفحة
- شبكة أيقونات وسائل الدفع في بطاقة البروفايل (نفس البيانات في #settings)
- ربط CSS live-store-map بلا خريطة

---

## النواقص في PortalShell

يجب نقلها قبل اعتبار الصفحة Fully Replaceable:
- صور المنتج المتعددة
- ترتيب العرض sort_order
- تقييم عرض المنتج (حقل الكتالوج)

اختياري غير حاجز: لصق الحافظة، KPI المشاهدات، إدراج التقييمات في القائمة الجانبية الأساسية (اليوم extra hash).

---

## الموقع

legacy يسمح بالتعديل: رابط Maps أو lat,lng، GPS، حفظ PATCH /api/store/location.
#store يفعل نفس الشيء بنفس العقد.
لا خريطة اختيار نقطة في أي منهما.
الفجوة ليست الموقع.

---

## merchant-hub

هو إعداد ظهور المتجر للعملاء: نبذة، شعار، غلاف، وسائل دفع السلة.
ليس إعداد توصيل تشغيلي ولا لوحة طلبات.
في البوابة: الهوية في #store؛ وسائل الدفع في #settings؛ الفئة تُحفظ عبر نفس PATCH.

---

## المنتجات

Create/Read/Update/Disable: نعم في البوابة.
SKU / barcode / variants: غير موجودة في المصدرين.
العروض: سعر عرض في النموذجين + تبويب عروض في البوابة.
الفجوة: المعرض + الترتيب + تقييم الكرت.

---

## المحفظة والسحب

#wallet يغطي الرصيد والحركات والسجل وطلب السحب والحالات ورسائل الخطأ والحد 10 ر.س.
البوابة أوضح (آيبان، available/pending، سبب الرفض).
ليست سبباً لبقاء store-dashboard.

---

## reviews

كلاهما قائمة تقييمات (نجوم + تعليق + تاريخ) من نفس API.
لا رد ولا تصفية.
البوابة تعرض متوسط وعدد أكبر.
الوصول: #reviews (extra section) وليس عنصر القائمة الأساسية — فجوة اكتشاف لا فجوة بيانات.

---

## JavaScript legacy

الملف الوحيد للمنطق: سكربت مضمّن في store-dashboard.html.
UI: رسم الهيرو/المعاينة/KPI/نماذج.
Business الفريد: ثلاثة حقول المنتج أعلاه.
بقية الاستدعاءات مكررة في merchant-preview.js.

---

## القرار

**B — Replaceable After Small Gaps**

لا تغلق /store-dashboard حتى تُنقل: صور المنتج الإضافية، sort_order، تقييم عرض المنتج.
الموقع وmerchant-hub والمحفظة والتقييمات وCRUD الأساسي للمنتج موجودة في /merchant-dashboard.
