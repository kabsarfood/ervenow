# المرحلة 1 — Merchant Onboarding → Review → Completion → Publish

التاريخ: 2026-09-22  
النطاق: رحلة المطاعم والمتاجر فقط. بدون POS، بدون ساعات عمل، بدون دمج بوابات التاجر، بدون تغيير Login destination / دورة الطلب / المحفظة / Ledger.

## ماذا تغيّر

### فصل الاعتماد عن النشر
- حقل جديد `stores.publication_status` = `draft | published | paused`.
- `status` يبقى اعتماد الحساب (`pending | needs_info | approved | rejected`).
- `is_active` يبقى علماً تشغيلياً. موافقة الأدمن تضبط `is_active=true` حتى تعمل لوحة التاجر، لكنها تترك `publication_status=draft`.
- الظهور في `/restaurants` و `/stores` والخريطة العامة يتطلّب: **معتمد + منشور**.
- الإرث: المتاجر المعتمدة الظاهرة سابقاً عُلّمت `published` حتى لا تختفي (6 متاجر حالية).

هجرة: `shared/migration_store_onboarding_publish.sql`  
تشغيل: `node scripts/run-migration-store-onboarding-publish.js`

### 1) طلب الانضمام (`/register-store`)
بعد OTP يبقى الكيان `stores`. النموذج أصبح يشمل:
- اسم المنشأة
- النوع الأساسي: مطعم | متجر (نفس الجدول)
- الموقع
- رقم السجل + صورته (إلزامي)
- رقم الرخصة + صورتها (اختياري)
- منتجات أولية: اسم + سعر + صورة (واحد على الأقل)
- زر إرسال الطلب

بعد الإرسال: `status=pending` و `publication_status=draft`.  
الرسالة: **طلبك قيد المراجعة لدى ERVENOW** (`/pending-approval.html`).

إعادة الإرسال من `needs_info` تعدّل **نفس الصف** — لا طلب جديد ولا حساب جديد.

### 2) مراجعة الأدمن (شاشة الموافقات الحالية)
`عرض التفاصيل` لمتجر يفتح نافذة مراجعة تعرض: الاسم، الجوال، النوع، الخريطة، السجل وصورته، الرخصة وصورتها، المنتجات الأولية مع الصور والأسعار.

ثلاث قرارات على `PATCH /api/admin/store-requests/:id`:
- اعتماد → `approved` + `draft` (لا نشر)
- رفض → `rejected` + غير منشور
- طلب استكمال بيانات → `needs_info` + رسالة الأدمن + إشعار

### 3–4) بعد الاعتماد
إشعار واتساب + داخل التطبيق:

**تم اعتماد مطعمك/متجرك في ERVENOW. أكمل صفحة منشأتك لتظهر للعملاء.**

رابط: `/merchant-preview#complete` → قسم الإعدادات.

### 5–6) استكمال الصفحة ثم النشر
في `merchant-preview` (بدون بناء Product API جديد):
- الفئة، الشعار، الغلاف، الوصف
- المنتجات / الصور / الأسعار / التوفر عبر `/api/store/products` الحالي
- زر **اعتماد ونشر المنشأة** يظهر عند اكتمال الحد الأدنى
- Validation: اسم، موقع، فئة، شعار أو غلاف، منتج واحد بسعر صحيح ومتاح
- النجاح: `publication_status=published` وعندها فقط تظهر للعملاء

## ملفات أساسية
- `shared/utils/storePublication.js`
- `shared/migration_store_onboarding_publish.sql`
- `shared/messages/storeWhatsApp.js`
- `apps/store/routes.js` — تسجيل، قوائم، onboarding-status، publish
- `apps/admin/routes.js` — اعتماد/رفض/needs_info بدون نشر تلقائي
- `public/register-store.html` + CSS
- `public/pending-approval.html`
- `public/admin/modules/approvals.js` + نافذة المراجعة
- `public/assets/merchant-preview.js` — أكمل صفحتك + نشر
- `tests/unit/storePublication.test.js`
- `scripts/probe-onboarding-publish.js`

لم يُغيَّر: POS، ساعات العمل، `store-dashboard`/`merchant-preview` unification، Login destination، دورة الطلب، المحفظة، Ledger.

## الاختبارات

وحدة: `npx jest tests/unit/storePublication.test.js` — 12/12 نجحت.

هجرة قاعدة البيانات: الأعمدة موجودة. العدّ الحالي: published=6، draft=0.

Probe حي (صفوف مؤقتة ثم حذف): `node scripts/probe-onboarding-publish.js` → `PROBE_OK`.

| # | السيناريو | النتيجة |
|---|-----------|---------|
| 1 | مطعم جديد → طلب → pending | نجح. صف `restaurant` بحالة pending/draft وغير مدرج |
| 2 | متجر جديد → طلب → pending | نجح. صف `supermarket` pending/draft وغير مدرج |
| 3 | الأدمن يرى السجل/الرخصة/المنتجات/الصور/الموقع | واجهة مراجعة مربوطة بـ GET setup (خريطة + وثائق + منتجات). التحقق البصري الكامل يحتاج جلسة أدمن |
| 4 | needs_info → إشعار → تعديل → إعادة إرسال | الحالة needs_info مع الرسالة. إعادة الإرسال نفس الـ id إلى pending. إشعار واتساب + داخل التطبيق في مسار الأدمن |
| 5 | Reject لا ينشر | rejected + draft + غير مدرج |
| 6 | Approve لا يظهر للعامة | approved + is_active=true + publication_status=draft + غير مدرج في `/api/stores` |
| 7 | صاحب المنشأة يكمل الصفحة | `merchant-preview#complete` + قائمة تحقق + حفظ هوية/فئة/منتجات عبر APIs الحالية |
| 8 | Publish يظهر في `/restaurants` أو `/stores` | بعد publish يصبح listed. `/restaurants` الحي يعرض 6 مطاعم منشورة فقط |
| 9 | المنتج يظهر في `/store.html` | مطعم النخبة للاسماك — المنتج «صيادية سمك» ظاهر مع إضافة للسلة |
| 10 | الطلبات والمحافظ لا تتأثر | لا مسارات order/wallet/ledger لم تُمس. الـ probe لم يكتب عليها |

واجهة: `/pending-approval.html` يعرض «طلبك قيد المراجعة لدى ERVENOW». `/store.html` لمتجر منشور يعرض الكتالوج.

لم يُنفَّذ من المتصفح مسار OTP كامل لمطعم/متجر جديد (يتطلّب جوالاً حقيقياً). مسار القاعدة + الوحدة + القوائم العامة يغطي المنطق.

## الخطوة التالية (ليست ضمن هذا التنفيذ)
POS، ساعات العمل، توحيد `store-dashboard` و `merchant-preview`، حذف البوابات القديمة.
