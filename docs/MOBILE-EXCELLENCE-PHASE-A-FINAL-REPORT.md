# ERVENOW Mobile Excellence — Phase A Final Report

**التاريخ:** 2026-06-11  
**الحالة:** إصلاحات CLS + إخفاء الشريط في الدفع — جاهز للمراجعة  
**لم يُنفَّذ Commit**

---

## 1. إصلاح CLS

### المصدر الرئيسي (تشخيص `scripts/mobile-cls-debug.js`)

| المصدر | CLS تقريبي | السبب |
|--------|------------|--------|
| `SECTION.sn-section` + `lp-header__top-row` | **~0.66** | الهيدر يبدأ بصفّين (index-header-banner) ثم يُضغط بعد تفعيل Foundation عبر JS |
| `SECTION.sn-section` | **~0.31** | البنر `#homeMainBanner` كان `hidden` ثم يظهر بعد API فيُزاح المحتوى |
| حقن الشريط السفلي + `padding-bottom` متأخر | **~0.05** | مساحة الشريط لم تُحجز قبل JS |

### ما تم إصلاحه

| الإجراء | الملف |
|---------|--------|
| تفعيل `html.erv-mobile-shell` مبكراً + ارتفاعات ثابتة للهيدر | `viewport-fit.js` |
| قواعد الهيدر المضغوط **مضمّنة** (بدون `@import` متأخر) | `index-header-banner.css`, `guest-shell.css` |
| حجز `padding-bottom` / `padding-top` قبل JS | `mobile-foundation-shell.css` + تضمين في guest-shell |
| حجز مكان البنر وهو `hidden` | `guest-offers-carousel.css` |
| placeholder للبنر قبل API | `guest-offers-carousel.js` |
| شريط سفلي shell ثابت → يُملأ بمحتوى دون إضافة ارتفاع | `viewport-fit.js`, `mobile-foundation.js` |
| إزالة تعديلات الرئيسية المتأخرة عبر JS (كانت تسبب قفز البنر) | `mobile-foundation.css` |

### النتيجة النهائية — الرئيسية `/` (390px)

| المقياس | Before (تدقيق) | After Phase A | **Final** | الهدف |
|---------|----------------|---------------|-----------|--------|
| **CLS** | 0.268* | 0.631 | **0.033** | &lt; 0.1 ✅ |
| **LCP** | 1484 ms* | 1512 ms | **1392 ms** | لا تراجع ✅ |
| **FCP** | 1012 ms* | 932 ms | **916 ms** | لا تراجع ✅ |

\*Before = قياس محلي بتعطيل `mobile-foundation.*` (تقرير After Review).

**عنصر LCP:** `IMG.guest-offers-slide__img` (لم يتغير).

---

## 2. صفحة الدفع — إخفاء Bottom Navigation

| المسار | الشريط السفلي | `erv-mobile-no-nav` |
|--------|---------------|------------------------|
| `/checkout` | **مخفي** ✅ | ✅ |
| `/cart` | مخفي ✅ | ✅ |
| `/pay` | مخفي ✅ | ✅ |
| باقي الصفحات | ظاهر | — |

**التنفيذ:** `viewport-fit.js` + `mobile-foundation.js` — `isPaymentFlowPath()`.

**لقطة:** `docs/screenshots/mobile-excellence/final/checkout-mobile-390-final.png`

---

## 3. مقارنة Before / After / Final

### الأداء — الرئيسية

```
         CLS      LCP      FCP
Before   0.268    1484ms   1012ms
After    0.631    1512ms    932ms   ← قبل إصلاح CLS
Final    0.033    1392ms    916ms   ← بعد الإصلاح
```

### تجربة الجوال

| المحور | Before | After | Final |
|--------|--------|-------|-------|
| هيدر الرئيسية | ~218px | 98px | 98px |
| شريط سفلي | لا | نعم | نعم (مخفي في الدفع) |
| CLS مقبول | ⚠️ | ❌ | ✅ |
| انطباع أول | 6.5/10 | 7.8/10 | **8.0/10** |

**+0.2** في التقييم بعد استقرار التخطيط (لا قفز بصري عند التحميل).

### لقطات

| المرحلة | المسار |
|---------|--------|
| Before | `docs/screenshots/mobile-excellence/before/` |
| After (أول تنفيذ) | `docs/screenshots/mobile-excellence/after/` |
| **Final** | `docs/screenshots/mobile-excellence/final/` |

---

## 4. الملفات المعدّلة (هذه الجولة)

| الملف | التغيير |
|-------|---------|
| `public/assets/viewport-fit.js` | `erv-mobile-shell` مبكر، مسارات الدفع، nav shell |
| `public/assets/mobile-foundation.js` | ملء shell، إخفاء nav في الدفع |
| `public/assets/mobile-foundation-shell.css` | **جديد** — قواعد الحجز (مرجع) |
| `public/assets/mobile-foundation.css` | إزالة تعديلات homepage المتأخرة |
| `public/assets/index-header-banner.css` | هيدر lp مضمّن آخر الملف |
| `public/assets/guest-shell.css` | shell مضمّن آخر الملف |
| `public/assets/guest-offers-carousel.css` | حجز بنر `[hidden]` |
| `public/assets/guest-offers-carousel.js` | `reserveCarouselSlot()` |
| `scripts/mobile-cls-debug.js` | **جديد** — تشخيص CLS |
| `scripts/mobile-excellence-phase-a-final-verify.js` | **جديد** — قياس نهائي |

---

## 5. ملاحظات

- **لوحة الزائر** CLS ~0.24 (بنر ديناميكي مشابه) — خارج نطاق إغلاق الرئيسية؛ يُعالج لاحقاً بنفس نمط حجز البنر.
- **الدفع** CLS ~0.11 (هامش فوق 0.1 بقليل) — بدون شريط سفلي؛ لا تعارض CTA.
- **لم يُمس** `index.html` ولا صفحات المطاعم/المتاجر/الخدمات (محتوى).

---

## 6. التوصية النهائية

### **A) جاهز للاعتماد والـ Commit**

**المبرر:**
- CLS الرئيسية **0.033** (تحت 0.1).
- LCP/FCP لم تتأثر سلباً.
- الشريط السفلي **مخفي في `/checkout`** ومسارات الدفع.
- أهداف المرحلة A مكتملة.

---

## إعادة القياس

```bash
node scripts/mobile-cls-debug.js
node scripts/mobile-excellence-phase-a-final-verify.js
node scripts/mobile-excellence-phase-a-capture.js after
```

المقاييس: `docs/screenshots/mobile-excellence/final/metrics-final.json`
