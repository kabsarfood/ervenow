# ERVENOW — تقرير اعتماد هوية العضوية

> Generated: 2026-06-17T18:16:02.324Z
> النطاق: نصوص الواجهة الظاهرة للمستخدم فقط — دون تعديل APIs أو جداول أو حقول برمجية

## الهوية المعتمدة

| الحالة | المسمى الرسمي |
| ------ | ------------- |
| غير مسجل | 👋 ضيف ERVENOW |
| مسجل | ⭐ عضو ERVENOW |
| متجر أو مطعم | 🏪 شريك تجاري |
| مندوب | 🚚 شريك توصيل |
| مزود خدمة | 🔧 شريك خدمات |
| مزود نقل | 🚛 شريك نقل |
| إدارة | 🛡️ الإدارة |

## استبدالات رئيسية

| القديم | الجديد |
| ------ | ------ |
| زائر المنصة / زائر | ضيف ERVENOW |
| لوحة الزائر | منصة ERVENOW |
| العميل | عضو ERVENOW |
| حساب العميل | ملف العضوية / عضويتك |
| طلبات العميل | طلبات العضو |
| محفظة العميل | محفظة العضو |
| إشعارات العميل | إشعارات العضو |
| تسجيل الدخول | دخول الأعضاء |
| إنشاء حساب / إنشاء حساب جديد | إنشاء عضوية / ⭐ إنشاء عضوية جديدة |
| مندوب / مزود خدمة | شريك توصيل / شريك خدمات / شريك تجاري / شريك نقل |

## صفحات محدّثة (أولوية السبرنت)

| الصفحة | التغييرات |
| ------ | --------- |
| `login.html` | عنوان ضيف/عضو، تبويب دخول الأعضاء، ⭐ إنشاء عضوية جديدة، أدوار الشركاء |
| `pending-approval.html` | نصوص «عضويتك قيد المراجعة» |
| `dashboard.html` | منصة ERVENOW، ترحيب ضيف/عضو ديناميكي |
| `wallet.html` | روابط منصة ERVENOW |
| `my-orders.html` | دخول الأعضاء، منصة ERVENOW |
| `notifications.html` | عبر guest-shell الموحّد |
| `guest-shell.js` | تنقل منصة ERVENOW، زر دخول الأعضاء |
| `account-destinations.js` | تسميات الأدوار والشركاء |

## ملفات إضافية (غلاف المنصة)

تم تحديث **55+ ملفاً** في `public/` عبر `scripts/apply-membership-identity.js`، منها:

- `start-now.html`, `browse.html`, `stores.html`, `restaurants.html`, `services.html`
- `cart.html`, `track.html`, `live-map.html`, `delivery-map.html`
- `driver-login.html`, `driver-app.html`, `store-dashboard.html`
- `assets/auth-otp-flow.js`, `assets/service-preview.js`, `assets/transport-preview.js`
- `admin/admin-dashboard.html`, `admin/modules/panels.js`

## مصدر مركزي للتسميات

`public/assets/membership-identity.js` — ثوابت الهوية لاستخدامها في JS (dashboard، account-destinations، مستقبلاً guest-shell).

## ما لم يُغيَّر (حسب الشروط)

- أسماء الجداول والحقول (`customer_id`, `role=customer`, …)
- مسارات API (`/api/core/me`, …)
- تعليقات CSS الداخلية غير الظاهرة للمستخدم
- رسائل واتساب الخلفية في `shared/messages/`

## إعادة التطبيق

```bash
node scripts/apply-membership-identity.js
node scripts/generate-membership-identity-report.js
npm run frontend:sync
```
