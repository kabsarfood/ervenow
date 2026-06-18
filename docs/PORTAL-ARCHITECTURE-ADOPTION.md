# ERVENOW — اعتماد الهيكل النهائي للبوابات

**التاريخ:** 17 يونيو 2026  
**الحالة:** معتمد · تنفيذ المرحلة 1 (توجيه + تكوين)  
**المرجع:** قرار إداري بعد التقرير المعماري

---

## القرار المعتمد

### البوابات التشغيلية الرسمية (Portal Framework)

| البوابة | المسار | الحالة |
|---------|--------|--------|
| **ERVENOW Merchant** | `/merchant-preview` | معاينة — legacy: `/store-dashboard` |
| **ERVENOW Driver** | `/driver-preview` | معاينة — legacy: `/driver` |
| **ERVENOW Service** | `/service-preview` | live |
| **ERVENOW Transport** | `/transport-preview` | live |

### خارج Portal Framework

| الدور | الوجهة | الملاحظة |
|-------|--------|----------|
| **العميل** | `/start-now.html` والمنصة الرئيسية | لا بوابة مستقلة |
| **الإدارة** | `/admin-dashboard` | ERVENOW Admin Console |

### المبدأ

> العميل يستخدم المنصة · الإدارة تدير المنصة · البوابات لمن يشغّل الأعمال ويحقق الدخل.

---

## ما تم تنفيذه (المرحلة 1)

- تحديث `shared/utils/portalLaunch.js` — 4 بوابات تشغيلية فقط
- تحديث `resolvePortalRole.js` و`role-routing.js` — العميل → `/start-now.html`
- إزالة `customer` و`admin` من `role-context.js` وconfigs
- تحديث `merchant` — إضافة Categories وWithdrawals
- إعادة توجيه 301 من `/customer-preview` → `/start-now.html`
- تحديث `login.html` و`account-destinations.js`
- تحديث مراقبة الأدمن (Role Separation / Preview Monitor)
- تحديث `data/portal-launch.json` و`role-separation-soft-launch.json`

---

## تقرير التأثير — ملفات ومسارات

### أ) ملفات تم تعديلها

| الملف | نوع التأثير |
|-------|-------------|
| `shared/utils/portalLaunch.js` | مصدر الحقيقة — 4 بوابات تشغيلية |
| `shared/utils/resolvePortalRole.js` | تسميات + تصدير `OPERATIONAL_PORTAL_ROLES` |
| `shared/utils/adminRoleTaxonomy.js` | إزالة customer portal من التصنيف |
| `shared/services/roleSeparationReport.js` | تقارير Soft Launch للبوابات التشغيلية فقط |
| `public/assets/role-routing.js` | مرآة المتصفح |
| `public/assets/account-destinations.js` | العميل → المنصة الرئيسية |
| `public/assets/portal-framework/role-context.js` | 4 configs فقط |
| `public/assets/portal-framework/configs/merchant.json` | هيكل Merchant المعتمد |
| `public/assets/portal-framework/portal-operational.js` | إزالة customer title |
| `public/login.html` | fallbacks بعد OTP |
| `public/admin/modules/readiness-monitor.js` | KPIs للبوابات التشغيلية |
| `server/server.js` | redirect `/customer-preview` |
| `data/portal-launch.json` | توثيق الحالة |
| `data/role-separation-soft-launch.json` | ملاحظات Soft Launch |
| `tests/unit/resolvePortalRole.test.js` | توقعات المسارات |
| `tests/unit/roleSeparationReport.test.js` | بنية التقرير |

### ب) ملفات تم حذفها

| الملف | السبب |
|-------|-------|
| `public/assets/portal-framework/configs/customer.json` | إلغاء Customer Portal |
| `public/assets/portal-framework/configs/admin.json` | Admin خارج Framework |

### ج) ملفات مرشّحة للحذف (المرحلة 2 — لم تُنفَّذ بعد)

| الملف / المسار | السبب | البديل |
|----------------|-------|--------|
| `public/customer-preview.html` | معاينة ملغاة | `/start-now.html` |
| `public/assets/customer-preview.js` | تطبيق معاينة ملغى | صفحات المنصة |
| `public/assets/customer-preview.css` | إن وُجد | أنماط المنصة الرئيسية |
| `ervenow-frontend/customer-preview.html` | نسخة Vercel | مزامنة بعد الحذف |
| `ervenow-frontend/assets/customer-preview.js` | نسخة Vercel | — |
| `ervenow-frontend/assets/portal-framework/configs/customer.json` | مكرر | — |
| `ervenow-frontend/assets/portal-framework/configs/admin.json` | مكرر | — |
| `ervenow-frontend/assets/portal-framework/portal-framework/**` | نسخة متداخلة ميتة | حذف المجلد بالكامل |

### د) مسارات HTTP المتأثرة

| المسار | قبل | بعد |
|--------|-----|-----|
| `/customer-preview` | صفحة بوابة عميل | **301 → `/start-now.html`** |
| Post-login (عميل) | `/customer-preview` | `/start-now.html` |
| Post-login (admin) | `/admin-dashboard` | بدون تغيير |
| Post-login (merchant) | `/store-dashboard` | بدون تغيير (حتى live) |
| Post-login (driver) | `/driver` | بدون تغيير (حتى live) |
| `/merchant-preview` | معاينة تاجر | بدون تغيير |
| `/service-preview` | بوابة خدمة | بدون تغيير |
| `/transport-preview` | بوابة نقل | بدون تغيير |

### هـ) صفحات المنصة الرئيسية للعميل (بدون بوابة)

| المسار | الوظيفة |
|--------|---------|
| `/` · `/start-now.html` | الرئيسية والاستكشاف |
| `/restaurants` | المطاعم |
| `/stores` | المتاجر |
| `/services` | الخدمات |
| `/delivery-services.html` | التوصيل |
| `/my-orders` · `/orders` | الطلبات |
| `/wallet.html` | المحفظة |
| `/notifications` | الإشعارات |
| `/dashboard` | لوحة الزائر/الحساب |

### و) بيانات ومراقبة

| الملف | التأثير |
|-------|---------|
| `data/admin-readiness.json` | قد يحتوي مفاتيح `customer` قديمة — تُهمل تدريجياً |
| `shared/utils/adminReadinessStore.js` | يتبع `PORTAL_DEFINITIONS` الجديدة (4 بوابات) |
| `shared/middleware/adminReadinessPageTrack.js` | يصنّف المسارات عبر taxonomy المحدّث |

### ز) اختبارات

| الملف | الحالة |
|-------|--------|
| `tests/unit/resolvePortalRole.test.js` | محدّث |
| `tests/unit/roleSeparationReport.test.js` | محدّث |
| `tests/unit/adminRoleTaxonomy.test.js` | بدون تغيير مطلوب |

---

## خارطة الطريق (Roadmap)

### المرحلة 1 — ✅ الحالية

- تثبيت القرار في التوجيه والتكوين
- إعادة توجيه `/customer-preview`
- إزالة configs العميل/الأدمن من Framework

### المرحلة 2 — مقترحة

- حذف ملفات `customer-preview.*`
- مزامنة `ervenow-frontend/` عبر `npm run frontend:sync`
- حذف المجلد المتداخل `ervenow-frontend/assets/portal-framework/portal-framework/`
- تنفيذ أقسام Merchant: `categories` · `withdrawals` في `merchant-preview.js`

### المرحلة 3 — مقترحة

- تفعيل `PORTAL_LIVE.merchant` و`PORTAL_LIVE.driver`
- إغلاق legacy: redirect من `/store-dashboard` و`/driver`
- إزالة `sidebarFoot` للوحات الكلاسيكية

---

## مرجع التكوين

```js
// shared/utils/portalLaunch.js
OPERATIONAL_PORTAL_ROLES = ["merchant", "driver", "service", "transport"]
CUSTOMER_PLATFORM_HOME = "/start-now.html"
ADMIN_CONSOLE_PATH = "/admin-dashboard"
```

---

## الجدول النهائي المعتمد

| البوابة | الاسم | بوابة مستقلة؟ | الوجهة |
|---------|-------|---------------|--------|
| Merchant | ERVENOW Merchant | ✅ نعم | `/merchant-preview` |
| Driver | ERVENOW Driver | ✅ نعم | `/driver-preview` |
| Service | ERVENOW Service | ✅ نعم | `/service-preview` |
| Transport | ERVENOW Transport | ✅ نعم | `/transport-preview` |
| العميل | المنصة الرئيسية | ❌ لا | `/start-now.html` + صفحات المنصة |
| الإدارة | ERVENOW Admin Console | ❌ لا (خارج Framework) | `/admin-dashboard` |
