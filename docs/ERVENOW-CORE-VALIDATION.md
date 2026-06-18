# ERVENOW Core Validation Report

**التاريخ:** 2026-06-18  
**النطاق:** Merchant · Driver · Service · Transport  
**الإصدار المستهدف:** ERVENOW Core 1.0

---

## النتيجة النهائية

| البوابة    | النتيجة |
| ---------- | ------- |
| Merchant   | **PASS** |
| Driver     | **PASS** |
| Service    | **PASS** |
| Transport  | **PASS** |

**الحكم:** جميع البوابات الأربع اجتازت التحقق التشغيلي الآلي (Structural + E2E UI).  
**الاعتماد:** ✅ **ERVENOW Core 1.0** — منصة تشغيل رسمية جاهزة للمرحلة التالية (Meshwar · POS · Loyalty بعد قرار منفصل).

---

## منهجية التحقق

| الطبقة | الأداة | الوصف |
| ------ | ------ | ----- |
| **Structural** | `node scripts/run-core-validation.js` | ملفات البوابة، أقسام UI، مسارات API، `portalLaunch` live، اختبارات وحدة |
| **E2E UI** | `npx playwright test tests/e2e/core-validation.spec.js` | تحميل البوابات ببيانات mock + لقطات شاشة |
| **Live Staging** | يدوي / Supabase | **لم يُنفَّذ في هذا السبرنت** — يُوصى به قبل الإنتاج الكامل |

نتائج JSON: [`docs/core-validation-results.json`](./core-validation-results.json)

---

## Merchant — PASS

### السيناريو المطلوب

```
عضو → طلب مطعم → إشعار التاجر → قبول → تجهيز → جاهز → مندوب → تسليم → محفظة → سحب
```

### ما تم التحقق منه

| المرحلة | التحقق | الحالة |
| ------- | ------ | ------ |
| بوابة live | `data/portal-launch.json` → `merchant: true` | ✅ |
| لوحة التحكم | KPIs · طلبات · محفظة | ✅ E2E |
| الطلبات | `renderOrders` + `/api/store/order-board` | ✅ |
| الفئات | CRUD + ترتيب + عدد المنتجات | ✅ E2E |
| السحوبات | KPIs · إنشاء طلب · حالة الرفض | ✅ E2E |
| الإشعارات | مركز داخل البوابة + فلاتر نوع | ✅ E2E |
| المحفظة | رصيد · معاملات | ✅ structural |
| دورة الطلب | `storeOrderWorkflow` unit tests | ✅ |

### لقطات الشاشة

| الملف | القسم |
| ----- | ----- |
| `validation-screenshots/merchant-dashboard.png` | لوحة التحكم |
| `validation-screenshots/merchant-orders.png` | الطلبات |
| `validation-screenshots/merchant-categories.png` | الفئات |
| `validation-screenshots/merchant-withdrawals.png` | السحوبات |
| `validation-screenshots/merchant-notifications.png` | الإشعارات |

### إصلاح حر أثناء السبرنت

- **Bug:** `merchant-preview.js` — IIFE بدون تمرير `window` → `ErvenowMerchantPreview` لم يُعرَّف.
- **Fix:** `})(typeof window !== "undefined" ? window : global);`

---

## Driver — PASS

### السيناريو المطلوب

```
تعيين → قبول → استلام → توصيل → إنهاء
```

### ما تم التحقق منه

| المرحلة | التحقق | الحالة |
| ------- | ------ | ------ |
| بوابة live | `portalLaunch.driver: true` | ✅ |
| لوحة التحكم | طلبات جاهزة / نشطة | ✅ E2E |
| الأرباح | `renderEarnings` + `/api/driver/earnings` | ✅ E2E |
| المحفظة | `renderWallet` + `/api/driver/wallet` | ✅ E2E |
| الإشعارات | `PortalNotificationsOps` + مركز الإشعارات | ✅ E2E |
| التقييم | `/api/driver/rating` | ✅ structural |
| Ledger | `driverStoreHandoff` · `ledgerWallet` tests | ✅ |

### لقطات الشاشة

| الملف | القسم |
| ----- | ----- |
| `validation-screenshots/driver-dashboard.png` | لوحة التحكم |
| `validation-screenshots/driver-earnings.png` | الأرباح |
| `validation-screenshots/driver-wallet.png` | المحفظة |
| `validation-screenshots/driver-notifications.png` | الإشعارات |

### إصلاح حر أثناء السبرنت

- **Bug:** `driver-preview.js` — نفس مشكلة IIFE.
- **Fix:** تمرير `window` في نهاية الـ IIFE.

---

## Service — PASS

### السيناريو المطلوب

```
حجز خدمة → قبول → إعادة جدولة → تنفيذ → إغلاق
```

### ما تم التحقق منه

| المرحلة | التحقق | الحالة |
| ------- | ------ | ------ |
| لوحة التحكم | `/api/services/me/dashboard` | ✅ E2E |
| الطلبات | `renderRequests` · حجز/قبول | ✅ structural |
| الجدولة | `renderSchedule` + `/api/services/me/schedule` | ✅ E2E |
| المحفظة | أرصدة في dashboard + `/api/wallet/transactions` | ✅ |
| الإشعارات | `onReserveBooking` | ✅ structural |

### لقطات الشاشة

| الملف | القسم |
| ----- | ----- |
| `validation-screenshots/service-dashboard.png` | لوحة التحكم |
| `validation-screenshots/service-schedule.png` | الجدولة |

---

## Transport — PASS

### السيناريو المطلوب

```
طلب نقل أو غاز → قبول → تنفيذ → إغلاق
```

### ما تم التحقق منه

| المرحلة | التحقق | الحالة |
| ------- | ------ | ------ |
| لوحة النقل | `portal_type: transport` | ✅ E2E |
| طلبات النقل | `renderTransportOrders` | ✅ structural |
| الأسطول | `renderFleet` + `/api/services/me/fleet` | ✅ E2E |
| التسعير | `renderPricing` + `/api/services/me/pricing` (غاز + عينات) | ✅ E2E |
| توجيه الغاز | نقل → transport portal | ✅ structural |

### لقطات الشاشة

| الملف | القسم |
| ----- | ----- |
| `validation-screenshots/transport-dashboard.png` | لوحة التحكم |
| `validation-screenshots/transport-fleet.png` | الأسطول |
| `validation-screenshots/transport-pricing.png` | التسعير |

---

## اختبارات الوحدة المشتركة

| المجموعة | الغرض |
| -------- | ----- |
| `orderPortalRouting` · `notificationPortalRouting` | توجيه الطلبات والإشعارات للبوابة الصحيحة |
| `notificationEvents` | أحداث الإشعار الموحّدة |
| `storeOrderWorkflow` · `driverStoreHandoff` | دورة طلب المتجر ↔ المندوب |
| `ledgerWallet` | محفظة وسجل الحركات |
| `resolvePortalRole` | توجيه الأدوار للبوابات الجديدة |

تشغيل: `npm test -- --testPathPattern="orderPortalRouting|notificationPortalRouting|..."`

---

## E2E — تشغيل التحقق

```bash
# تحقق هيكلي
node scripts/run-core-validation.js

# تحقق واجهة + لقطات
npx playwright test tests/e2e/core-validation.spec.js
```

اللقطات تُحفظ في: `docs/validation-screenshots/`

---

## قيود معروفة

1. **لا اتصال Supabase في بيئة الاختبار المحلية** — الخادم يُظهر `fetch failed` لمهام الخلفية؛ لا يؤثر على نتيجة التحقق الآلي.
2. **E2E يستخدم Mock APIs** — لم يُختبر مسار دفع حقيقي أو سحب معتمد من الأدمن على Staging.
3. **POS** مخفي عبر Platform Modules (`ervenow_pos: disabled`) — غير جزء من Core 1.0.
4. **Live E2E يدوي** على Staging مُوصى به قبل أول إطلاق إنتاجي كامل.

---

## قرار الاعتماد

بناءً على:

- ✅ Merchant · Driver · Service · Transport — **PASS**
- ✅ Portal Framework موحّد + إشعارات + محفظة + سحوبات (تاجر)
- ✅ `portalLaunch` live للتاجر والمندوب
- ✅ 14 لقطة شاشة توثيقية
- ✅ إصلاح عطل تحميل Merchant/Driver (IIFE)

**يُعتمد رسمياً:**

> **ERVENOW Core 1.0** — منصة تشغيل رسمية جاهزة للمرحلة التالية.

الوحدات التالية تبقى **خارج النطاق** حتى قرار منتج منفصل: Meshwar · POS · Loyalty.

---

*أُعدّ بواسطة ERVENOW Core Validation Sprint — 2026-06-18*
