# تشخيص شريط الأعلى تقييماً / الأكثر طلباً — الصفحة الرئيسية
التاريخ: 2026-09-26
النطاق: فحص كود فقط. لم يُنفَّذ تعديل.

## النتيجة

بيانات الشريط تُجلب عند فتح الصفحة، ثم تُستنسخ البطاقات في الصفحة وتتحرك بتحريك CSS. دورة التمرير لا تعيد fetch ولا استعلام Supabase.

الحركة في `public/assets/home-why-cta.css`:
`animation: ervRailSlide 42s linear infinite` على `#ervMpDiscover .erv-mp-rail`.
الإطار ينقل العنصر من `translate3d(-50%,0,0)` إلى `translate3d(0,0,0)`.
لا يوجد مستمع `animationiteration` ولا `transitionend` ولا `slideChange`.

`mountImageRail` في `public/assets/home-desktop-marketplace.js` ينسخ عقد DOM (`cloneNode`) ويلفّها. الإيقاف عند الضغط (`is-held`) يوقف الأنيميشن فقط (`animation-play-state: paused`). لا طلب شبكة داخل هذه الدالة.

## الجلب الذي يحدث فعلًا

يحدث داخل `loadDiscovery`، ويُستدعى من `refreshMp` عبر `setTimeout` لمرة واحدة بعد 80ms، لا من دورة الشريط:

- `GET /api/stores?sort=rating`
- إن رجعت القائمة فارغة: `GET /api/stores?limit=200`
- إن لم يوجد مطعم في النتيجة: `GET /api/stores?type=restaurant&sort=rating`
- `GET /api/store/products?store_id=...&limit=10&offset=0` لأول متجر فقط في قسم المنتجات
- مرة إضافية عند الإقلاع: `hydrateStatsStrip` → `GET /api/stores?limit=200` لعداد المتاجر، وهذا ليس الشريط

ترتيب «الأكثر طلباً» يتم في المتصفح بـ `sortByOrders` على القائمة التي وصلت. لا يوجد endpoint منفصل للأعلى طلباً أو الأعلى تقييماً يُستدعى مع كل حركة.

`refreshMp` (ومعها `loadDiscovery`) تعمل عند فتح الصفحة، وبعد 900ms، وعند حدث `ervenow:marketing-applied` مرة، وعند `resize` بعد تهدئة 250ms. لا توجد حلقة كل ساعة.

مؤقتات `placeStatsStrip` عند 1.2 و 2.4 و 8 و 20 و 35 ثانية تحرك عناصر الصفحة ولا تستدعي API.
`MutationObserver` على البانر وعلى هيكل الصفحة يعيد ترتيب DOM ويتوقف مراقب الهيكل بعد 8–10 ثوانٍ. لا يجلب متاجر.

## الطلبات في الساعة والصفحة مفتوحة بلا تغيير حجم

بعد دفعة الفتح: 0 طلب/ساعة من الشريط.
دفعة الفتح نفسها: نحو 2 إلى 4 استدعاءات `/api/stores` وصفر أو استدعاء واحد لـ `/api/store/products`، أي نحو 3–6 طلبات HTTP للخادم في الثواني الأولى، ثم تتوقف.

دورة CSS كل 42 ثانية × 24 ساعة ≈ 2,057 دورة بصرية. كل دورة = 0 طلب API.

## الربط مع 91 ألف طلب

الشريط لا يفسّر ارتفاع Supabase إلى حوالي 91 ألف خلال 24 ساعة.
حلقة بصرية بلا شبكة لا تتراكم مع مرور الوقت. حتى ألف زيارة للرئيسية × نحو 5 طلبات فتح ≈ 5 آلاف طلب خادم، وهذا داخل تكلفة فتح الصفحة التي شُخّصت سابقاً، وليس حلقة الشريط.

المصادر التي ما زالت تفسّر عشرات الآلاف هي استطلاع بوابات التشغيل كل 8 ثوانٍ، وتكرار استعلام `hero_banners` نحو 17 مرة في كل فتح للرئيسية، وإعادة المحاولة عند انقطاع TCP. تقرير ذلك: `docs/supabase-request-storm-diagnosis-2026-09-26.md`.

## الجدول

الملف | وظيفة الشريط | هل يوجد مؤقت | هل يعيد API | عدد الطلبات/ساعة | الحكم
public/assets/home-why-cta.css | تحريك ervRailSlide كل 42 ثانية بلا نهاية | لا مؤقت جافاسكربت. أنيميشن CSS فقط | لا | 0 | لا يضرب Supabase
public/assets/home-desktop-marketplace.js mountImageRail | نسخ البطاقات محلياً وإيقاف الحركة عند الضغط | لا setInterval. مستمعات pointer فقط | لا | 0 | حركة محلية
public/assets/home-desktop-marketplace.js loadDiscovery | جلب الأعلى تقييماً وفرز الأكثر طلباً ورسم الشريط | setTimeout 80ms عند كل refreshMp، ليس كل دورة | نعم: /api/stores ومرة /api/store/products | 0 بعد الفتح. 3–6 طلبات في الثواني الأولى فقط | ليس سبب الـ 91 ألف
public/assets/home-desktop-marketplace.js hydrateStatsStrip | عداد عدد المتاجر | مرة عند boot | نعم: /api/stores?limit=200 | 0/ساعة | خارج الشريط، مرة واحدة
refreshMp عند resize و marketing-applied | إعادة جلب ثم إعادة بناء الشريط | resize مهدّأ 250ms. الحدث مرة عند تطبيق التسويق | نعم، نفس جلب loadDiscovery | 0 إذا بقيت النافذة ثابتة | دفعة فتح، لا حلقة
