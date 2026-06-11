# ERVENOW Mobile Harmony — P0 Report

**التاريخ:** 2026-06-11  
**النطاق:** جوال فقط (≤640px) · بدون تغيير Desktop · بدون تغيير منطق السلة/الطلبات/الحساب

---

## الهدف

إزالة ازدواجية الوظائف بين الهيدر العلوي والشريط السفلي:

- **الهيدر** = هوية المنصة + القائمة
- **Bottom Navigation** = التنقل الرئيسي (بما فيها السلة)
- **نقطة وصول واحدة للسلة** على الجوال

---

## ما تم تنفيذه

### 1. السلة — إخفاء بصري من الهيدر

| العنصر | قبل | بعد |
|--------|-----|-----|
| `.lp-draft-checkout-badge` / `.dash-header-cart` في الهيدر | ظاهر (guest-shell) / مخفي بصرياً (الرئيسية مع shell) | **مخفي بصرياً** (`clip` + `opacity:0`) |
| `#cartCount` في DOM | موجود | **ما زال موجود** للمزامنة |
| عنصر السلة في Bottom Nav | موجود | **بدون تغيير** |
| عداد `#ervMobileNavCartBadge` | — | يظهر عند `count > 0` فقط |

### 2. الهيدر — ترتيب الجوال

| الموضع | المحتوى |
|--------|---------|
| **يسار** | شعار ERVENOW |
| **وسط** | ERVENOW + المنصة الذكية |
| **يمين** | ☰ القائمة (نفس محتوى القائمة، بدون حذف روابط) |

### 3. الملفات الرئيسية

- `public/assets/mobile-harmony.css` — إخفاء السلة + تخطيط lp-header + guest-shell
- `public/assets/mobile-harmony.js` — قائمة guest-shell (☰ + لوحة روابط)
- `public/assets/mobile-foundation.css` — محاذاة هيدر الرئيسية (`grid-column` 1/2/3)
- `public/assets/index-header-banner.css` — إلغاء قواعد الجوال القديمة عند `erv-mobile-shell`
- `public/index.html` — تحميل harmony بعد banner
- `public/assets/guest-shell.js` — تحميل harmony لصفحات guest-shell

---

## مقارنة الهيدر — Before / After (390px)

### الرئيسية `/`

| العنصر | Before (left) | After (left) | الحالة |
|--------|---------------|--------------|--------|
| ☰ القائمة | 12 | **334** | يمين ✓ |
| شعار | 66 | **12** | يسار ✓ |
| ERVENOW + المنصة الذكية | 306 | **159** | وسط ✓ |
| ارتفاع الهيدر | 66px | 66px | مضغوط ✓ |

### guest-shell (`/start-now`, `/restaurants`)

| العنصر | Before | After |
|--------|--------|-------|
| ☰ | 320 (يمين) | 320 (يمين) ✓ |
| هوية | 78 (وسط) | 78 (وسط) ✓ |
| شعار | 26 (يسار) | 26 (يسار) ✓ |
| سلة الهيدر | ظاهرة | **مخفية** ✓ |

---

## التحقق — السلة

| فحص | النتيجة |
|-----|---------|
| `#cartCount` في DOM | ✓ |
| سلة الهيدر مرئية | ✗ (مقصود) |
| عنصر السلة في Bottom Nav | ✓ |
| عداد واحد مرئي (`count=0`) | ✓ (الشارة مخفية عند الصفر — سلوك طبيعي) |
| Desktop | **بدون تغيير** (قواعد `@media min-width: 641px`) |

---

## Screenshots

| Phase | المسار |
|-------|--------|
| **Before** (مقاييس + ملاحظة) | `docs/screenshots/mobile-excellence/harmony-p0-before/audit-metrics.json` |
| **After** | `docs/screenshots/mobile-excellence/harmony-p0-after/` |
| | `home-header-390.png` |
| | `start-now-header-390.png` |
| | `restaurants-header-390.png` |
| | `audit-metrics.json` |

> **ملاحظة Before:** لم تُلتقط لقطات Before قبل التنفيذ؛ المقاييس مأخوذة من baseline ما قبل إصلاح تخطيط الرئيسية (انظر `audit-metrics.json`).

---

## تشغيل التدقيق

```bash
node scripts/mobile-harmony-audit.js after
```

---

## الحالة

| البند | الحالة |
|-------|--------|
| إزالة السلة من الهيدر (جوال) | ✓ |
| ترتيب الهيدر (يسار/وسط/يمين) | ✓ |
| Bottom Nav بدون تغيير | ✓ |
| Desktop بدون تغيير | ✓ |
| Commit | **لم يُنفَّذ** — بانتظار مراجعتك |

---

## التوصية

**جاهز للمراجعة والموافقة (A)** — بعد التأكد البصري على جهاز جوال حقيقي، خاصة فتح القائمة ☰ والانتقال للسلة من الشريط السفلي.
