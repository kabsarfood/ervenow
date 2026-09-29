# تقرير روابط المتجر — ماذا فُعل؟

تاريخ: 2026-09-29
النطاق: توحيد بوابة التاجر دون حذف الصفحات القديمة.

## ماذا كان الوضع؟

كان للتاجر أكثر من مدخل:

- /merchant-preview — PortalShell (النموذج الجديد)
- /merchant-dashboard — صفحة أخرى أو مسار موازٍ
- /store-dashboard — اللوحة القديمة
- /order-board — تشغيل الطلبات منفصل

النتيجة: روابط متفرقة، وواجهتا طلبات.

## ماذا فعلنا؟

ثبتنا مساراً رسمياً واحداً للتشغيل داخل البوابة:

/merchant-dashboard

نفس التطبيق (PortalShell + merchant-preview.js) يعمل على:

- /merchant-dashboard
- /merchant-preview

كلاهما يستدعي ErvenowMerchantPreview.init(). الهاش يبقى على نفس المسار (لا يقفز بين صفحتين).

## الروابط الرسمية بعد العمل

الدخول / نوع الحساب / معظم الهيدر والمحفظة في الـ shells:

- بوابة التاجر: /merchant-dashboard
- الرئيسية: /merchant-dashboard#home
- الطلبات: /merchant-dashboard#orders
- المتجر: /merchant-dashboard#store
- المنتجات: /merchant-dashboard#products
- الكاشير: /merchant-dashboard#pos
- المحفظة: /merchant-dashboard#wallet
- الموظفون: /merchant-dashboard#employees
- التقارير: /merchant-dashboard#reports
- الإعدادات: /merchant-dashboard#settings

Aliases ما زالت تُفهم داخل نفس الصفحة: dashboard→home، withdrawals→wallet، categories/offers→products، cashiers→employees، complete→settings.

## ماذا لم نفعل؟ (معتمد منك)

لا حذف ولا Redirect حتى تعتمد النتيجة:

- /order-board ما زال موجوداً ويعمل
- /store-dashboard ما زال موجوداً (مسار قديم في role-routing كـ legacy فقط)
- /merchant-preview لم يُحذف؛ هو نفس التطبيق على مسار المعاينة
- لم نغيّر API ولا RLS ولا schema

من داخل order-board أضفنا روابط إلى البوابة (#home و #orders) دون إجبار التحويل.

## المرحلة 2 — الطلبات

جعلنا /merchant-dashboard#orders واجهة تشغيل الطلبات داخل البوابة:

- عدادات الحالات، بحث، تاريخ، تفاصيل، قبول/تجهيز/جاهز
- طباعة حرارية، مندوب، خريطة عند فتح الطلب، تتبع
- Socket واحد + poll 45 ثانية احتياطي (حلقة واحدة في PortalShell)
- لا رفض طلب (لا يوجد تدفق API له)

/order-board لم يُحذف ولم يُحوَّل تلقائياً.

## أين ما زال رابط قديم؟

- store-shell ما زال يعرض بند «لوحة الطلبات» → /order-board (لم نقطع الروابط الخارجية القديمة)
- PORTAL_LEGACY_PATHS.merchant = /store-dashboard (مرجع قديم، الوجهة الحية هي /merchant-dashboard)
- في index.html مسار محفظة الهيدر للتاجر ما زال يشير في موضع واحد إلى /store-dashboard#wallet بينما guest-shell يستخدم /merchant-dashboard#wallet — هذا بقايا لم تُغلق في مرحلة الروابط الرسمية

## القرار الحالي

نعم: رابط التشغيل الرسمي للمتجر هو /merchant-dashboard مع هاش الأقسام.

لم نعلن إغلاق /order-board أو /store-dashboard. Redirect والحذف مؤجلان حتى تعتمد النتيجة.
